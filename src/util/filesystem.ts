
import {Stats as FSStats} from 'fs';
import {ListingElement as FTPStats} from 'ftp';
import { FileInfo, FileType } from './fileinfo';

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

export function splitFileName(path:string):FileNameSet
{
    var pathidx = path.lastIndexOf('/');
    var dir = (pathidx === -1) ? "" : path.substr(0, pathidx);
    return {
        dir: dir,
        name: path.substr(pathidx+1)
    };
}

export abstract class State extends FileInfo
{
	ftppath:string = '';
	type:FileType = '';
	name:string = '';
	size:number = 0;
	date:number = 0;
	linkType:FileType|undefined = undefined;
	lmtime:number = 0;
	lmtimeWithThreshold:number = 0;
	modified:boolean = false;

	constructor(public fs:FileSystem, public parent:Directory|undefined, name:string)
	{
		super();

		this.name = name;
	}

	getFullPath():string
	{
		const names:string[] = [this.name];
		var p = this.parent;
		while (p)
		{
			names.push(p.name);
			p = p.parent;
		}
		return names.reverse().join('/');
	}

	abstract serialize():SerializedState;
	abstract deserialize(data:SerializedState):void;
	abstract setByInfo(file:FileInfo):void;

}

export abstract class FileCommon extends State
{
	constructor(fs:FileSystem, parent:Directory|undefined, name:string)
	{
		super(fs, parent, name);
	}
	
	setByStat(st:FSStats):void
	{
		this.size = st.size;
		this.lmtime = +st.mtime;
		this.lmtimeWithThreshold = this.lmtime + 1000;
	}

	setByInfo(file:FileInfo):void
	{
		this.ftppath = file.ftppath;
		this.size = file.size;
		this.date = file.date;
	}
}

export class Directory extends FileCommon
{
	files:{[key:string]:State|undefined} = {};

	constructor(fs:FileSystem, parent:Directory|undefined, name:string)
	{
		super(fs, parent, name);
		
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

	deserialize(data:SerializedState):void
	{
		if (typeof data !== 'object') return;
		for (const filename in data)
		{
			const sfile = data[filename];
			if (!sfile) continue;
			if (typeof sfile !== 'object') continue;

			var file:State;
			switch (sfile.type)
			{
			case '-':
				file = new File(this.fs, this, filename);
				break;
			case 'l':
				file = new SymLink(this.fs, this, filename);
				break;
			default:
				file = new Directory(this.fs, this, filename);
				break;
			}
			file.deserialize(sfile);
			this.files[filename] = file;
		}
	}

	setByInfos(list:FileInfo[]):void
	{
		var nfiles = {};
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
					case 'd': file = new Directory(this.fs, this, ftpfile.name); break;
					case '-': 
						file = new File(this.fs, this, ftpfile.name);
						break;
					case 'l':
						file = new SymLink(this.fs, this, ftpfile.name);
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
}


export class SymLink extends FileCommon
{
	constructor(fs:FileSystem, parent:Directory, name:string)
	{
		super(fs, parent, name);
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

export class File extends FileCommon
{
	constructor(fs:FileSystem, parent:Directory, name:string)
	{
		super(fs, parent, name);
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

export class FileSystem
{
	root:Directory;

	constructor()
	{
    	this.reset();
	}

	serialize():any
	{
		return this.root.serialize();
	}

	deserialize(data:SerializedState):void
	{
		this.root.deserialize(data);
	}
	
	reset():void
	{
		this.root = new Directory(this, undefined, "");
	}

	putByStat(path:string, st:FSStats):void
	{
		var file:FileCommon;
		var fn = splitFileName(path);
		var dir = <Directory>this.get(fn.dir, true);

		if (st.isSymbolicLink()) file = new SymLink(this, dir, fn.name);
		else if(st.isDirectory()) file = new Directory(this, dir, fn.name);
		else if(st.isFile()) file = new File(this, dir, fn.name);
		else throw Error('invalid file');
		file.setByStat(st);
		dir.files[fn.name] = file;
	}

	get(path:string, make?:boolean):Directory|undefined
	{
		const dirs = path.split("/");
		var dir:Directory = this.root;
		for (const cd of dirs)
		{
			const ndir = dir.files[cd];
			if(ndir)
			{
				if (ndir instanceof Directory)
				{
					dir = ndir;
					continue;
				}
			}
			if (!make) return undefined;
			dir = dir.files[cd] = new Directory(this, dir, cd);
		}
		return dir;
	}

	refresh(path:string, list:FileInfo[]):Directory
	{
		const dir = <Directory>this.get(path, true);
		dir.setByInfos(list);
		return dir;
	}

	create(path:string):File
	{
		const fn = splitFileName(path);
		const dir = <Directory>this.get(fn.dir, true);
		const file = dir.files[fn.name] = new File(this, dir, fn.name);
		return file;
	}

	delete(path:string):void
	{
		const fn = splitFileName(path);
		const dir = this.get(fn.dir);
		if (dir) delete dir.files[fn.name];
	}

	mkdir(path:string):Directory
	{
		return <Directory>this.get(path, true);
	}
}
