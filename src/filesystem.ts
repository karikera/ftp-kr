
import {Stats as FSStats} from 'fs';
import {ListingElement as FTPStats} from 'ftp';

interface FileNameSet
{
	dir:string;
	name:string;
}

interface SerializedState
{
	type?:string;// d
	name?:string;
	size?:number;
	files?:SerializedState[];
	target?:string;
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

export abstract class State
{
	parent:Directory;
	type:string = "";
	lmtime:number = 0;
	size:number = 0;
	ignoreUploadTime:number = 0;

	constructor(parent:Directory|null, public name:string)
	{
		if (parent) this.parent = parent;
		else if (this instanceof Directory) this.parent = this;
		else throw TypeError('Internal error, construct State without directory parameter');
	}

	abstract serialize():SerializedState;
	abstract deserialize(file:SerializedState, add?:boolean):void;

}

export abstract class FileCommon extends State
{
	constructor(parent:Directory|null, name:string)
	{
		super(parent, name);
	}
	
	setByStat(st:FSStats):void
	{
		this.size = st.size;
	}

	deserialize(file:SerializedState, add?:boolean)
	{
		if (file.size !== undefined) this.size = file.size;
	}

	serialize():SerializedState
	{
		return {
			type: this.type,
			name: this.name,
			size: this.size
		};  
	}
}

export class Directory extends FileCommon
{
	files:{[key:string]:State} = {};

	constructor(parent:Directory|null, name:string)
	{
		super(parent, name);
		
		this.type = "d";

		this.files[""] = this.files["."] = this;
		this.files[".."] = this.parent;
	}
	
	serialize():SerializedState
	{
		const out = super.serialize(); 

		var olist:SerializedState[] = [];
		for(var name in this.files)
		{
			switch(name)
			{
			case "": case ".": case "..": break;
			default: olist.push(this.files[name].serialize()); break;
			}
		}
		out.type = "d";
		out.files = olist;
		return out;
	}

	deserialize(file:SerializedState, add?:boolean):void
	{
		super.deserialize(file, add);
		if (file.files) this.readFiles(file.files, add);
	}

	readFiles(list:SerializedState[], add?:boolean):void
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
			case ".": this.deserialize(ftpfile, add); break;
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
				file.deserialize(ftpfile, add);
				break;
			}
		}
		this.files = nfiles;
	}
}


export class SymLink extends FileCommon
{
	target:string = '';
	type:string = 'l';

	constructor(parent:Directory, name:string)
	{
		super(parent, name);
	}

	serialize():SerializedState
	{
		var out = super.serialize();
		out.target = this.target;
		return out;
	}

	deserialize(file:SerializedState):void
	{
		if (file.target) this.target = file.target;
		return super.deserialize(file);
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
		this.root = new Directory(null, "");
	}

	putByStat(path:string, st:FSStats):void
	{
		var file;
		var fn = splitFileName(path);
		var dir = <Directory>this.get(fn.dir, true);

		if (st.isSymbolicLink()) file = new SymLink(dir, fn.name);
		else if(st.isDirectory()) file = new Directory(dir, fn.name);
		else if(st.isFile()) file = new File(dir, fn.name);
		file.setByStat(st);
		dir.files[fn.name] = file;
		return file;
	}

	get(path:string, make?:boolean):Directory|null
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
			if (!make) return null;
			dir = dir.files[cd] = new Directory(dir, cd);
		}
		return dir;
	}

	refresh(path:string, list:SerializedState[]):Directory
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

	serialize():SerializedState
	{
		return this.root.serialize();
	}

	deserialize(data:SerializedState, add?:boolean):void
	{
		this.root.deserialize(data, add);
	}
}
