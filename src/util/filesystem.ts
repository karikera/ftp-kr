
import {Stats as FSStats} from 'fs';
import {ListingElement as FTPStats} from 'ftp';
import { FileInfo, FileType } from './fileinfo';
import { File } from 'krfile';
import { Event } from './event';

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
	
	constructor(
		public readonly parent:VFSDirectory|undefined, 
		public readonly name:string)
	{
		super();

		if (parent)
		{
			this.fs = parent.fs;
		}
		else if (this instanceof VirtualFileSystem)
		{
			this.fs = this;
		}
		else
		{
			throw Error('Invalid parameter');
		}
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

	public refreshContent():Promise<void>
	{
		if (!this.contentCached) return Promise.resolve();
		this.contentCached = false;
		return this.fs.onRefreshContent.fire(this);
	}

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
	
	setByStat(st:FSStats):void
	{
		this.size = st.size;
		this.lmtime = +st.mtime;
		this.lmtimeWithThreshold = this.lmtime + 1000;
	}

	setByInfo(file:FileInfo):void
	{
		this.size = file.size;
		this.date = file.date;
	}
}

export class VFSDirectory extends VFSFileCommon
{
	private files:{[key:string]:VFSState|undefined} = {};

	constructor(parent:VFSDirectory|undefined, name:string)
	{
		super(parent, name);
		
		this.type = "d";

		this.files[""] = this.files["."] = this;
		this.files[".."] = this.parent;
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
		var nfiles:{[key:string]:(VFSState|undefined)} = {};
		nfiles["."] = nfiles[""] = this;
		nfiles[".."] = this.parent;

		for(var ftpfile of list)
		{
			_nofile:switch (ftpfile.name)
			{
			case undefined: break;
			case "..": break;
			case ".": this.setByInfo(ftpfile); break;
			default:
				var file = this.files[ftpfile.name];
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
					}
					else if (file.type === '-' && ftpfile.size !== file.size)
					{
						file.modified = true;
					}
				}
				nfiles[ftpfile.name] = file;
				file.setByInfo(ftpfile);
				break;
			}
		}

		this.files = nfiles;

		this.refreshContent();
		if (this.treeCached)
		{
			this.treeCached = false;
			this.fs.onRefreshTree.fire(this);
		}
	}
	
	public putBySerialized(path:string, data:SerializedState):void
	{
		var fn = splitFileName(path);
		var dir = <VFSDirectory>this.getFromPath(fn.dir, true);
		dir.deserializeTo(fn.name, data);
	}
	
	public putByStat(path:string, st:FSStats):void
	{
		var file:VFSFileCommon;
		const fn = splitFileName(path);
		const dir = <VFSDirectory>this.getFromPath(fn.dir, true);

		if (st.isSymbolicLink()) file = new VFSSymLink(dir, fn.name);
		else if(st.isDirectory()) file = new VFSDirectory(dir, fn.name);
		else if(st.isFile()) file = new VFSFile(dir, fn.name);
		else throw Error('invalid file');
		file.setByStat(st);
		dir.setItem(fn.name, file);
	}

	public * children():Iterable<VFSState>
	{
		for (const name in this.files)
		{
			switch(name)
			{
			case '': case '.': case '..': continue;
			}
			
			const file = this.files[name];
			if (!file) continue;
			yield file;
		}
	}

	public item(name:string):VFSState|undefined
	{
		return this.files[name];
	}

	public setItem(name:string, item:VFSState):void
	{
		const old = this.files[name];
		this.files[name] = item;
		if (old) old.refreshContent();
		if (this.treeCached)
		{
			this.treeCached = false;
			this.fs.onRefreshTree.fire(this);
		}
	}

	public deleteItem(name:string):boolean
	{
		const old = this.files[name];
		if (!old) return false;
		old.refreshContent();
		delete this.files[name];
		if (this.treeCached)
		{
			this.treeCached = false;
			this.fs.onRefreshTree.fire(this);
		}
		return true;
	}

	public getFromPath(path:string, make?:boolean):VFSDirectory|undefined
	{
		const dirs = path.split("/");
		var dir:VFSDirectory = this;
		for (const cd of dirs)
		{
			const ndir = dir.files[cd];
			if(ndir)
			{
				if (ndir instanceof VFSDirectory)
				{
					dir = ndir;
					continue;
				}
			}
			if (!make) return undefined;
			dir = new VFSDirectory(dir, cd);
			this.setItem(cd, dir);
		}
		return dir;
	}
	
	public createFromPath(path:string):VFSFile
	{
		const fn = splitFileName(path);
		const dir = <VFSDirectory>this.getFromPath(fn.dir, true);
		const file = new VFSFile(dir, fn.name);
		dir.setItem(fn.name, file);
		return file;
	}

	public deleteFromPath(path:string):void
	{
		const fn = splitFileName(path);
		const dir = this.getFromPath(fn.dir);
		if (dir) dir.deleteItem(fn.name);
	}

	public mkdir(path:string):VFSDirectory
	{
		return <VFSDirectory>this.getFromPath(path, true);
	}

	public refresh(path:string, list:FileInfo[]):VFSDirectory
	{
		const dir = <VFSDirectory>this.getFromPath(path, true);
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

	serialize():SerializedState
	{
		return {
			type:this.type,
			size:this.size,
			lmtime:this.lmtime,
			modified:this.modified,
		};
	}
	deserialize(data:SerializedState):void
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
