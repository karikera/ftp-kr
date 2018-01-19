
import {Stats as FSStats} from 'fs';
import {ListingElement as FTPStats} from 'ftp';
import { FileInfo, FileType } from './fileinfo';

interface FileNameSet
{
	dir:string;
	name:string;
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
	linkType:FileType|undefined = undefined;
	parent:Directory;
	lmtime:number = 0;
	lmtimeWithThreshold:number = 0;

	constructor(parent:Directory|undefined, name:string)
	{
		super();

		this.name = name;

		if (parent) this.parent = parent;
		else if (this instanceof Directory) this.parent = this;
		else throw TypeError('Internal error, construct State without directory parameter');
	}

	abstract readFile(file:FileInfo, add?:boolean):void;

}

export abstract class FileCommon extends State
{
	constructor(parent:Directory|undefined, name:string)
	{
		super(parent, name);
	}
	
	setByStat(st:FSStats):void
	{
		this.size = st.size;
	}

	readFile(file:FileInfo, add?:boolean)
	{
		this.ftppath = file.ftppath;
		this.size = file.size;
		this.date = file.date;
		this.link = file.link;
	}
}

export class Directory extends FileCommon
{
	files:{[key:string]:State|undefined} = {};

	constructor(parent:Directory|undefined, name:string)
	{
		super(parent, name);
		
		this.type = "d";

		this.files[""] = this.files["."] = this;
		this.files[".."] = this.parent;
	}

	readFiles(list:FileInfo[], add?:boolean):void
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
			case ".": this.readFile(ftpfile, add); break;
			default:
				var file = this.files[ftpfile.name];
				if ((!add) || (!file || file.type !== ftpfile.type))
				{ 
					switch (ftpfile.type)
					{
					case 'd': file = new Directory(this, ftpfile.name); break;
					case '-': file = new File(this, ftpfile.name); break;
					case 'l': file = new SymLink(this, ftpfile.name); break;
					default: break _nofile;
					}
				}
				nfiles[ftpfile.name] = file;
				file.readFile(ftpfile, add);
				break;
			}
		}
		this.files = nfiles;
	}
}


export class SymLink extends FileCommon
{
	constructor(parent:Directory, name:string)
	{
		super(parent, name);
		this.type = 'l';
	}
}

export class File extends FileCommon
{
	constructor(parent:Directory, name:string)
	{
		super(parent, name);
		this.type = "-";
	}
}

export class FileSystem
{
	root:Directory;

	constructor()
	{
    	this.reset();
	}
	
	reset():void
	{
		this.root = new Directory(undefined, "");
	}

	putByStat(path:string, st:FSStats):void
	{
		var file:FileCommon;
		var fn = splitFileName(path);
		var dir = <Directory>this.get(fn.dir, true);

		if (st.isSymbolicLink()) file = new SymLink(dir, fn.name);
		else if(st.isDirectory()) file = new Directory(dir, fn.name);
		else if(st.isFile()) file = new File(dir, fn.name);
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
			dir = dir.files[cd] = new Directory(dir, cd);
		}
		return dir;
	}

	refresh(path:string, list:FileInfo[]):Directory
	{
		const dir = <Directory>this.get(path, true);
		dir.readFiles(list, true);
		return dir;
	}

	create(path:string):File
	{
		const fn = splitFileName(path);
		const dir = <Directory>this.get(fn.dir, true);
		const file = dir.files[fn.name] = new File(dir, fn.name);
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

	readFile(data:FileInfo, add?:boolean):void
	{
		this.root.readFile(data, add);
	}
}
