
import * as fs from 'fs';
import * as util from './util';
import glob from './pglob';
import {sep} from 'path';
import * as os from 'os';


const win32 = os.platform() === 'win32';

function win32_drivePrefix(path:string):string
{
	if (path.charAt(1) === ':') return path.substr(0, 2);
	if (path.startsWith('\\\\'))
	{
		const driveidx = path.indexOf('\\', 2);
		if (driveidx === -1) return path;
		return path.substr(0, driveidx);
	}
	return '';
}

function win32_join(...path:string[]):string
{
	var i = path.length;
	while (i--)
	{
		const p = path[i];
		if (p.charAt(1) === ':')
		{
			return mypath.normalize(path.slice(i).join('\\'));
		}
		if (p.startsWith('\\\\'))
		{
			return mypath.normalize(path.slice(i).join('\\'));
		}
		if (p.startsWith('\\') || p.startsWith('/'))
		{
			var j = i;
			while (j--)
			{
				const p2 = path[j];
				const driveprefix = win32_drivePrefix(p2);
				if (driveprefix)
				{
					return mypath.normalize(driveprefix + path.slice(i).join('\\'));
				}
			}
			return mypath.normalize(path.slice(i).join('\\'));
		}
	}
	return mypath.normalize(path.join('/'));
}

function unix_join(...path:string[]):string
{
	var i = path.length;
	while (i--)
	{
		const p = path[i];
		if (p.startsWith('\\') || p.startsWith('/'))
		{
			return mypath.normalize(path.slice(i).join('/'));
		}
	}
	return mypath.normalize(path.join('/'));
}

function win32_resolve(path:string):string
{
	if (path.charAt(1) === ':')
	{
		return mypath.normalize(path);
	}
	else if (path.startsWith('/') || path.startsWith('\\'))
	{
		return mypath.join(process.cwd(), path);
	}
	else
	{
		return mypath.normalize(path);
	}
}

function unix_resolve(path:string):string
{
	if (path.startsWith('/') || path.startsWith('\\'))
	{
		return mypath.join(process.cwd(), path);
	}
	else
	{
		return mypath.normalize(path);
	}
}

const mypath = {
	dirname(path:string):string
	{
		const idx = path.lastIndexOf(sep);
		if (idx === -1) return '';
		return path.substr(0, idx);
	},

	normalize(path:string):string
	{
		const npath:string[] = [];
		const pathes = path.split(/[\\\/]/g);
		for (const p of pathes)
		{
			switch (p)
			{
			case '..':
				if (npath.length === 0 || npath[npath.length-1] === '..')
				{
					npath.push('..');
				}
				else
				{
					npath.pop();
				}
				break;
			case '':
			case '.':
				break;
			default:
				npath.push(p);
				break;
			}
		}
		const res = npath.join(sep);
		if (path.startsWith('\\\\')) return '\\\\'+res;
		if (path.startsWith('\\') || path.startsWith('/')) return sep + res;
		return res;
	},

	resolve:win32? win32_resolve : unix_resolve,
	join:win32 ? win32_join : unix_join,
};


function mkdirParent(dirPath:string, callback:(err?:Error)=>void):void
{
    return fs.mkdir(dirPath, error=>{
        if (error)
        {
            switch(error.code)
            {
			case 'EEXIST':
				callback();
				return;
            case 'ENOENT':
                return mkdirParent(mypath.dirname(dirPath), () => fs.mkdir(dirPath, callback));
            }
        }
        callback && callback(error);
    });
}

export type Stats = fs.Stats;

export class File
{
	constructor(public readonly fsPath:string)
	{
	}

	public toString():string
	{
		throw Error('Blocked to find bug');
	}

	in(parent:File):boolean
	{
		return this.fsPath.startsWith(parent.fsPath + sep);
	}

	initJson(defaultValue:Object):Promise<any>
	{
		return this.json().then((data)=>{
			var changed = false;
			for (var p in defaultValue)
			{
				if (p in data) continue;
				data[p] = defaultValue[p];
				changed = true;
			}
			if (!changed) return data;
			return this.create(JSON.stringify(data, null, 4))
			.then(()=> data);
		})
		.catch(()=>{
			return this.create(JSON.stringify(defaultValue, null, 4))
			.then(() => Object.create(defaultValue));
		});
	}

	basename():string
	{
		const idx = this.fsPath.lastIndexOf(sep);
		return this.fsPath.substr(idx+1);
	}

	ext():string
	{
		const name = this.basename();
		const idx = name.indexOf('.');
		if (idx === -1) return '';
		return name.substr(idx+1);
	}

	reext(newext:string):File
	{
		const pathidx = this.fsPath.lastIndexOf(sep);
		const extidx = this.fsPath.indexOf('.', pathidx+1);
		if (extidx === -1) new File(this.fsPath+'.'+newext);
		return new File(this.fsPath.substr(0, extidx+1)+newext);
	}
	
	async children():Promise<File[]>
	{
		const files = await util.callbackToPromise<string[]>((callback)=>fs.readdir(this.fsPath, callback));
		return files.map(filename=>this.child(filename));
	}

	static parse(pathname:string)
	{
		return new File(mypath.resolve(pathname));
	}

	sibling(filename:string):File
	{
		return new File(mypath.join(mypath.dirname(this.fsPath), filename));
	}

	child(...filename:string[]):File
	{
		return new File(mypath.join(this.fsPath, ...filename));
	}

	parent():File
	{
		return new File(mypath.dirname(this.fsPath));
	}

	relativeFrom(parent:File):string|undefined
	{
		const parentPath = parent.fsPath;
		const fsPath = this.fsPath;
		if (fsPath.startsWith(parentPath))
		{
			if (parentPath.length === fsPath.length) return '.';
			const rpath = fsPath.substr(parentPath.length).replace(/\\/g, '/');
			if (rpath.startsWith('/'))
			{
				return rpath.substr(1);
			}
		}
		return undefined;
	}

	async glob(pattern:string):Promise<File[]>
	{
		const files = await glob(this.child(pattern).fsPath);
		return files.map(path=>File.parse(path));
	}

	stat():Promise<fs.Stats>
	{
		return util.callbackToPromise((callback)=>fs.stat(this.fsPath, callback));
	}

	mtime():Promise<number>
	{
		return this.stat().then(stat=>+stat.mtime).catch(e=>{
			if (e.code === 'ENOENT') return -1;
			throw e;
		});
	}

	mkdir():Promise<void>
	{
		return new Promise<void>((resolve, reject)=>{
			fs.mkdir(this.fsPath, (err)=>{
				if (err)
				{
					switch (err.code)
					{
					case 'EEXIST': resolve(); return;
					default: reject(err); return;
					}
				}
				else resolve();
			});
		});
	}

	mkdirp():Promise<void>
	{
		return util.callbackToPromise<void>(callback=>mkdirParent(this.fsPath, callback));
	}

	lstat():Promise<fs.Stats>
	{
		return util.callbackToPromise((callback)=>fs.lstat(this.fsPath, callback));
	}

	open():Promise<string>
	{
		return util.callbackToPromise((callback)=>fs.readFile(this.fsPath, "utf-8", callback));
	}

	createWriteStream():fs.WriteStream
	{
		return fs.createWriteStream(this.fsPath);
	}

	exists():Promise<boolean>
	{
		return new Promise((resolve) => fs.exists(this.fsPath, resolve));
	}

	async json():Promise<any>
	{
		const data = await this.open();
		try
		{
			return util.parseJson(data);
		}
		catch(err)
		{
			if (err instanceof Error) err.file = this;
			throw err;
		}
	}

	create(data:string):Promise<void>
	{
		return this.parent().mkdirp()
		.then(() => util.callbackToPromise<void>((callback)=>fs.writeFile(this.fsPath, data, "utf-8", callback)));
	}

	createSync(data:string)
	{
		return fs.writeFileSync(this.fsPath, data, "utf-8");
	}

	unlink():Promise<void>
	{
		return util.callbackToPromise<void>((callback)=>fs.unlink(this.fsPath, callback));
	}

	isDirectory():Promise<boolean>
	{
		return this.stat().then(stat=>stat.isDirectory());
	}
}
