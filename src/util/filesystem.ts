
import {Stats as FSStats} from 'fs';
import {ListingElement as FTPStats} from 'ftp';
import { FileInfo, FileType } from './fileinfo';
import { File } from 'krfile';

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
	type:FileType = '';
	size:number = 0;
	date:number = 0;
	linkType:FileType|undefined = undefined;
	lmtime:number = 0;
	lmtimeWithThreshold:number = 0;
	modified:boolean = false;
	
	constructor(
		public readonly parent:VFSDirectory|undefined, 
		public readonly name:string)
	{
		super();
	}

	getPath():string
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

	getUrl():string
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

	abstract serialize():SerializedState;
	abstract deserialize(data:SerializedState):void;
	abstract setByInfo(file:FileInfo):void;

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
	files:{[key:string]:VFSState|undefined} = {};

	constructor(parent:VFSDirectory|undefined, name:string)
	{
		super(parent, name);
		
		this.type = "d";

		this.files[""] = this.files["."] = this;
		this.files[".."] = this.parent;
	}

	serialize():SerializedState
	{
		var files:SerializedState = {};
		for (const filename in this.files)
		{
			const file = this.files[filename];
			if (!file) continue;
			switch (filename)
			{
			case '': case '.': case '..': continue;
			}
			files[filename] = file.serialize();
		}
		return files;
	}

	deserializeTo(filename:string, data:SerializedState):void
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
		this.files[filename] = file;
	}

	deserialize(data:SerializedState):void
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

	setByInfos(list:FileInfo[]):void
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
				delete this.files[ftpfile.name];
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
	}
	

	putBySerialized(path:string, data:SerializedState):void
	{
		var fn = splitFileName(path);
		var dir = <VFSDirectory>this.get(fn.dir, true);
		dir.deserializeTo(fn.name, data);
	}
	
	putByStat(path:string, st:FSStats):void
	{
		var file:VFSFileCommon;
		var fn = splitFileName(path);
		var dir = <VFSDirectory>this.get(fn.dir, true);

		if (st.isSymbolicLink()) file = new VFSSymLink(dir, fn.name);
		else if(st.isDirectory()) file = new VFSDirectory(dir, fn.name);
		else if(st.isFile()) file = new VFSFile(dir, fn.name);
		else throw Error('invalid file');
		file.setByStat(st);
		dir.files[fn.name] = file;
	}

	get(path:string, make?:boolean):VFSDirectory|undefined
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
			dir = dir.files[cd] = new VFSDirectory(dir, cd);
		}
		return dir;
	}
	
	create(path:string):VFSFile
	{
		const fn = splitFileName(path);
		const dir = <VFSDirectory>this.get(fn.dir, true);
		const file = dir.files[fn.name] = new VFSFile(dir, fn.name);
		return file;
	}

	delete(path:string):void
	{
		const fn = splitFileName(path);
		const dir = this.get(fn.dir);
		if (dir) delete dir.files[fn.name];
	}

	mkdir(path:string):VFSDirectory
	{
		return <VFSDirectory>this.get(path, true);
	}

	refresh(path:string, list:FileInfo[]):VFSDirectory
	{
		const dir = <VFSDirectory>this.get(path, true);
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
	constructor()
	{
		super(undefined, '');
	}

	save(file:File, extra:SerializedStateRoot):void
	{
		const obj:SerializedStateRoot = Object.assign(this.serialize(), extra);
		obj.$version = 1;
		file.createSync(JSON.stringify(obj, null, 2));
	}

	async load(file:File, defaultRootUrl:string):Promise<{[key:string]:any}>
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
					this.putServer(hostUrl, obj);
				}
				return extra;
			}
		}
		this.putServer(defaultRootUrl, data);
		return extra;
	}

	getServer(hostUrl:string):VFSServer
	{
		var server = <VFSServer | undefined>this.files[hostUrl];
		if (!server)
		{
			this.files[hostUrl] = server = new VFSServer(this, this, hostUrl);
		}
		return server;
	}
	putServer(hostUrl:string, data:SerializedState):VFSServer
	{
		const server = this.getServer(hostUrl);
		server.deserialize(data);
		return server;
	}
}
