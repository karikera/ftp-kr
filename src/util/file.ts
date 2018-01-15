
import * as fs from 'fs';
import * as path from 'path';
import * as util from './util';
import glob from './pglob';


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
                return mkdirParent(path.dirname(dirPath), () => fs.mkdir(dirPath, callback));
            }
        }
        callback && callback(error);
    });
}

export type Stats = fs.Stats;

export default class File
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
		return this.fsPath.startsWith(parent.fsPath + path.sep);
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
		return path.basename(this.fsPath);
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
		const pathidx = this.fsPath.lastIndexOf(path.sep);
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
		return new File(path.resolve(pathname));
	}

	sibling(filename:string):File
	{
		return new File(path.join(path.dirname(this.fsPath), filename));
	}

	child(...filename:string[]):File
	{
		var i = filename.length;
		while (i--)
		{
			if (path.isAbsolute(filename[i]))
			{
				return File.parse(path.join(...filename.slice(i)));
			}
		}
		return new File(path.join(this.fsPath, ...filename));
	}

	parent():File
	{
		return new File(path.dirname(this.fsPath));
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
			err.fsPath = this;
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
