
import * as fs from 'fs';
import * as path from 'path';
import * as util from './util';
import { workspace, Uri, WorkspaceFolder, ParameterInformation } from 'vscode';
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

export interface FileError extends Error
{
	path?:Path;
	line?:number;
	column?:number;
}

export class Path
{
	constructor(public readonly uri:Uri)
	{
	}

	public get fsPath():string
	{
		return this.uri.fsPath;
	}

	workspace():Workspace
	{
		const ws = workspace.getWorkspaceFolder(this.uri);
		if (ws === undefined) throw Error(this.fsPath+" is not in workspace");
		return Workspace.getInstance(ws);
	}

	workpath():string
	{
		const ws = this.workspace();
		if (!this.fsPath.startsWith(ws.fsPath)) throw Error(this.fsPath+" is not in workspace");
		return this.uri.fsPath.substr(ws.fsPath.length);
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
	
	async children():Promise<Path[]>
	{
		const files = await util.callbackToPromise<string[]>((callback)=>fs.readdir(this.fsPath, callback));
		return files.map(Path.parse);
	}

	static parse(pathname:string)
	{
		return new Path(Uri.parse(pathname));
	}

	sibling(filename:string):Path
	{
		return Path.parse(path.resolve(path.dirname(this.uri.fsPath), filename));
	}

	child(filename:string):Path
	{
		return Path.parse(path.resolve(this.uri.fsPath, filename));
	}

	parent():Path
	{
		return Path.parse(path.dirname(this.uri.fsPath));
	}

	async glob():Promise<Path[]>
	{
		const files = await glob(this.fsPath);
		return files.map(path=>Path.parse(path));
	}

	static async glob(path:Path[]):Promise<Path[]>
	{
		const narr:Path[] = [];
		narr.length = path.length;
		for (var i=0;i<path.length;i++)
		{
			const list = await path[i].glob();
			narr.push(... list);
		}
		return narr;
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
			err.path = this;
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

export interface WorkspaceItem<T>
{
	new(workspace:Workspace):T;
}

interface ItemMap
{
	get<T>(item:WorkspaceItem<T>):T|undefined;
	set<T>(item:WorkspaceItem<T>, T):void;
}

export class Workspace extends Path
{
	private static wsmap = new WeakMap<WorkspaceFolder, Workspace>();
	private items:ItemMap = new Map;

	constructor(public readonly workspaceFolder:WorkspaceFolder)
	{
		super(workspaceFolder.uri);
	}

	public item<T>(type:WorkspaceItem<T>):T
	{
		var item = this.items.get(type);
		if (item === undefined)
		{
			item = new type(this);
			this.items.set(type, item);
		}
		return item;
	}

	get name():string
	{
		return this.workspaceFolder.name;
	}

	static getInstance(workspace:WorkspaceFolder):Workspace
	{
		var ws = Workspace.wsmap.get(workspace);
		if (!ws)
		{
			ws = new Workspace(workspace);
			Workspace.wsmap.set(workspace, ws);
		}
		return ws;
	}

	static first():Workspace
	{
		if (workspace.workspaceFolders)
		{
			const ws = workspace.workspaceFolders[0];
			if (ws)
			{
				return Workspace.getInstance(ws);
			}
		}
		throw Error("Need workspace");
	}

	static * all():Iterable<Workspace>
	{
		if (workspace.workspaceFolders)
		{
			for(const ws of workspace.workspaceFolders)
			{
				yield Workspace.getInstance(ws);
			}
		}
	}
}
