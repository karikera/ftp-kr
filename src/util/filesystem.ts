
import {Stats as FSStats} from 'fs';
import {ListingElement as FTPStats} from 'ftp';
import { File } from 'krfile';

import { FileInfo, FileType } from './fileinfo';
import { Event } from './event';
import { ftp_path } from './ftp_path';

interface FileNameSet
{
	dir:string;
	name:string;
}

interface SerializedState
{
	[key:string]:(SerializedState|string|number|boolean|undefined);
	type?:string;
	size?:number;
	lmtime?:number;
	modified?:boolean;
}

interface SerializedStateRoot extends SerializedState
{
	$version?:number;
}

export function splitFileName(path:string):FileNameSet
{
    var pathidx = path.lastIndexOf('/');
    var dir = (pathidx === -1) ? "" : path.substr(0, pathidx);
    return {
        dir: dir,
        name: path.substr(pathidx+1)
    };
}

export abstract class VFSState extends FileInfo
{
	public type:FileType = '';
	public size:number = 0;
	public date:number = 0;
	public linkType:FileType|undefined = undefined;
	public lmtime:number = 0;
	public lmtimeWithThreshold:number = 0;
	public modified:boolean = false;

	public contentCached:boolean = false; // If it is set, fire refresh in next modification
	public treeCached:boolean = false; // If it is set, fire refresh in next modification

	public readonly fs:VirtualFileSystem;
	public readonly server:VFSServer|undefined;
	
	constructor(
		public readonly parent:VFSDirectory|undefined, 
		public readonly name:string)
	{
		super();


		this.fs = parent ? parent.fs : <any>this;
		if (!(this.fs instanceof VirtualFileSystem))
		{
			throw Error('Invalid parameter');
		}
		this.server = (parent instanceof VFSServer) ? parent : parent ? parent.server : undefined;
	}

	public getPath():string
	{
		const list:string[] = [];
		var file:VFSState|undefined = this;
		while (file && !(file instanceof VFSServer))
		{
			list.push(file.name);
			file = file.parent;
		}
		list.push('');
		if (list.length === 1) return '/.';
		return list.reverse().join('/');
	}

	public getUrl():string
	{
		const list:string[] = [this.name];
		var parent = this.parent;
		while (parent && !(parent instanceof VirtualFileSystem))
		{
			list.push(parent.name);
			parent = parent.parent;
		}
		return list.reverse().join('/');
	}

	public abstract refreshContent():Promise<void>;

	public abstract serialize():SerializedState;
	public abstract deserialize(data:SerializedState):void;
	public abstract setByInfo(file:FileInfo):void;

}

export abstract class VFSFileCommon extends VFSState
{
	constructor(parent:VFSDirectory|undefined, name:string)
	{
		super(parent, name);
	}
	
	public refreshContent():Promise<void>
	{
		if (!this.contentCached) return Promise.resolve();
		this.contentCached = false;
		return this.fs.onRefreshContent.fire(this);
	}

	public setByStat(st:FSStats):void
	{
		this.size = st.size;
		this.lmtime = +st.mtime;
		this.lmtimeWithThreshold = this.lmtime + 1000;
	}

	public setByInfo(file:FileInfo):void
	{
		this.size = file.size;
		this.date = file.date;
	}
}

export class VFSDirectory extends VFSFileCommon
{
	private files = new Map<string, VFSState>();

	constructor(parent:VFSDirectory|undefined, name:string)
	{
		super(parent, name);
		
		this.type = 'd';

		this.files.set('', this);
		this.files.set('.', this);
		if (this.parent) this.files.set('..', this.parent);
	}

	public async refreshContent():Promise<void>
	{
		for (const child of this.children())
		{
			await child.refreshContent();
		}
	}

	public serialize():SerializedState
	{
		const files:SerializedState = {};
		for (const file of this.children())
		{
			files[file.name] = file.serialize();
		}
		return files;
	}

	public deserializeTo(filename:string, data:SerializedState):void
	{
		var file:VFSState;
		switch (data.type)
		{
		case '-':
			file = new VFSFile(this, filename);
			break;
		case 'l':
			file = new VFSSymLink(this, filename);
			break;
		default:
			file = new VFSDirectory(this, filename);
			break;
		}
		file.deserialize(data);
		this.setItem(filename, file);
	}

	public deserialize(data:SerializedState):void
	{
		if (typeof data !== 'object') return;
		for (const filename in data)
		{
			const sfile = data[filename];
			if (!sfile) continue;
			if (typeof sfile !== 'object') continue;
			this.deserializeTo(filename, sfile);
		}
	}

	public setByInfos(list:FileInfo[]):void
	{
		var nfiles = new Map<string,VFSState>();
		this.files.set('', this);
		this.files.set('.', this);
		if (this.parent) this.files.set('..', this.parent);

		var childrenChanged = false;

		for(var ftpfile of list)
		{
			_nofile:switch (ftpfile.name)
			{
			case undefined: break;
			case "..": break;
			case ".": this.setByInfo(ftpfile); break;
			default:
				var file = this.files.get(ftpfile.name);
				const oldfile = file;
				if (!file || file.type !== ftpfile.type)
				{ 
					switch (ftpfile.type)
					{
					case 'd': file = new VFSDirectory(this, ftpfile.name); break;
					case '-': 
						file = new VFSFile(this, ftpfile.name);
						break;
					case 'l':
						file = new VFSSymLink(this, ftpfile.name);
						break;
					default: break _nofile;
					}
				}
				if (oldfile)
				{
					if (file !== oldfile)
					{
						file.modified = true;
						childrenChanged = true;
						file.refreshContent();
					}
					else if (file.type === '-' && ftpfile.size !== file.size)
					{
						file.modified = true;
						file.refreshContent();
					}
				}
				nfiles.set(ftpfile.name, file);
				file.setByInfo(ftpfile);
				break;
			}
		}

		this.files = nfiles;

		if (childrenChanged && this.treeCached)
		{
			this.treeCached = false;
			this.fs.onRefreshTree.fire(this);
		}
	}
	
	public putBySerialized(path:string, data:SerializedState):void
	{
		const fn = splitFileName(path);
		const dir = <VFSDirectory>this.getDirectoryFromPath(fn.dir, true);
		dir.deserializeTo(fn.name, data);
	}
	
	public putByStat(path:string, st:FSStats):void
	{
		const fn = splitFileName(path);
		const dir = <VFSDirectory>this.getDirectoryFromPath(fn.dir, true);

		var file:VFSFileCommon;
		if (st.isSymbolicLink()) file = new VFSSymLink(dir, fn.name);
		else if(st.isDirectory()) file = new VFSDirectory(dir, fn.name);
		else if(st.isFile()) file = new VFSFile(dir, fn.name);
		else throw Error('invalid file');
		file.setByStat(st);
		dir.setItem(fn.name, file);
	}

	public * children():Iterable<VFSState>
	{
		for (const [name, file] of this.files)
		{
			switch(name)
			{
			case '': case '.': case '..': continue;
			}
			yield file;
		}
	}

	public item(name:string):VFSState|undefined
	{
		return this.files.get(name);
	}

	public get fileCount():number
	{
		return this.files.size;
	}

	public setItem(name:string, item:VFSState):void
	{
		const old = this.files.get(name);
		this.files.set(name, item);
		if (old) old.refreshContent();

		if (this.treeCached)
		{
			if (!old || item.type === old.type)
			{
				this.treeCached = false;
				this.fs.onRefreshTree.fire(this);
			}
		}
	}

	public deleteItem(name:string):boolean
	{
		const old = this.files.get(name);
		if (!old) return false;
		old.refreshContent();
		this.files.delete(name);
		if (this.treeCached)
		{
			this.treeCached = false;
			this.fs.onRefreshTree.fire(this);
		}
		return true;
	}

	public getDirectoryFromPath(path:string, make?:boolean):VFSDirectory|undefined
	{
		const dirs = path.split("/");
		var dir:VFSDirectory = this;
		for (const cd of dirs)
		{
			const ndir = dir.files.get(cd);
			if(ndir)
			{
				if (ndir instanceof VFSDirectory)
				{
					dir = ndir;
					continue;
				}
			}
			if (!make) return undefined;
			const maked = new VFSDirectory(dir, cd);
			dir.setItem(cd, maked);
			dir = maked;
		}
		return dir;
	}

	public getFromPath(ftppath:string):VFSState|undefined
	{
		const parent = ftp_path.dirname(ftppath);
		const dir = this.getDirectoryFromPath(parent);
		if (!dir) return undefined;
		return dir.item(ftp_path.basename(ftppath));
	}
	
	public createFromPath(path:string):VFSFile
	{
		const fn = splitFileName(path);
		const dir = <VFSDirectory>this.getDirectoryFromPath(fn.dir, true);
		const file = new VFSFile(dir, fn.name);
		dir.setItem(fn.name, file);
		return file;
	}

	public deleteFromPath(path:string):void
	{
		const fn = splitFileName(path);
		const dir = this.getDirectoryFromPath(fn.dir);
		if (dir) dir.deleteItem(fn.name);
	}

	public mkdir(path:string):VFSDirectory
	{
		return <VFSDirectory>this.getDirectoryFromPath(path, true);
	}

	public refresh(path:string, list:FileInfo[]):VFSDirectory
	{
		const dir = <VFSDirectory>this.getDirectoryFromPath(path, true);
		dir.setByInfos(list);
		return dir;
	}
}

export class VFSServer extends VFSDirectory
{
	constructor(public readonly fs:VirtualFileSystem, parent:VFSDirectory|undefined, name:string)
	{
		super(parent, name);
	}
}

export class VFSSymLink extends VFSFileCommon
{
	constructor(parent:VFSDirectory, name:string)
	{
		super(parent, name);
		this.type = 'l';
	}

	public getLinkTarget():VFSState|undefined
	{
		if (!this.server) return undefined;
		var link:VFSState|undefined = this;
		while (link instanceof VFSSymLink)
		{
			if (!link.link) return undefined;
			link = this.server.getFromPath(link.link);
		}
		return link;
	}
	public refreshContent():Promise<void>
	{
		if (this.link)
		{
			const target = this.getLinkTarget();
			if (!target) return Promise.resolve();
			else return target.refreshContent();
		}
		else
		{
			return super.refreshContent();
		}
	}

	public serialize():SerializedState
	{
		return {
			type:this.type,
			size:this.size,
			lmtime:this.lmtime,
			modified:this.modified,
		};
	}
	public deserialize(data:SerializedState):void
	{
		this.size = Number(data.size) || 0;
		this.lmtime = Number(data.lmtime) || 0;
		this.modified = Boolean(data.modified);
	}
}

export class VFSFile extends VFSFileCommon
{
	constructor(parent:VFSDirectory, name:string)
	{
		super(parent, name);
		this.type = "-";
	}

	public serialize():SerializedState
	{
		return {
			type:this.type,
			size:this.size,
			lmtime:this.lmtime,
			modified:this.modified,
		};
	}
	public deserialize(data:SerializedState):void
	{
		this.size = Number(data.size) || 0;
		this.lmtime = Number(data.lmtime) || 0;
		this.modified = Boolean(data.modified);
	}
}

export class VirtualFileSystem extends VFSDirectory
{
	public readonly onRefreshContent = Event.make<VFSState>('onRefreshContent', false);
	public readonly onRefreshTree = Event.make<VFSState>('onRefreshTree', false);
	/// ftpList -> fire onRefreshTree -> refreshTree -> readTreeNode -> ftpList

	constructor()
	{
		super(undefined, '');
	}

	public save(file:File, extra:SerializedStateRoot):void
	{
		const obj:SerializedStateRoot = Object.assign(this.serialize(), extra);
		obj.$version = 1;
		file.createSync(JSON.stringify(obj, null, 2));
	}

	public async load(file:File, defaultRootUrl:string):Promise<{[key:string]:any}>
	{
		const extra:{[key:string]:any} = {};
		const datatext = await file.open();
		const data = JSON.parse(datatext);
		if (typeof data.$version !== 'object')
		{
			const version = data.$version;
			delete data.$version;
			switch (version)
			{
			case 1:
				for (const hostUrl in data)
				{
					if (hostUrl.startsWith('$'))
					{
						extra[hostUrl] = data[hostUrl];
						continue;
					}
					const obj = data[hostUrl];
					if (typeof obj !== 'object') continue;
					this.putBySerialized(hostUrl, obj);
				}
				return extra;
			}
		}
		this.putBySerialized(defaultRootUrl, data);
		return extra;
	}

	public children():Iterable<VFSServer>
	{
		return <Iterable<VFSServer>>super.children();
	}

	public item(hostUrl:string):VFSServer
	{
		const server = super.item(hostUrl);
		if (server) return <VFSServer>server;
		const nserver = new VFSServer(this, this, hostUrl);
		this.setItem(hostUrl, nserver);
		return nserver;
	}

	public setItem(name:string, item:VFSServer):void
	{
		super.setItem(name, item);
	}

	public putBySerialized(hostUrl:string, data:SerializedState):VFSServer
	{
		const server = this.item(hostUrl);
		server.deserialize(data);
		return server;
	}
}
