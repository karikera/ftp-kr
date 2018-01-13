
import * as fs from 'fs';
import * as path from 'path';
import * as util from './util';
import * as event from './event';
import { workspace, Uri, WorkspaceFolder, ParameterInformation, Disposable } from 'vscode';
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

export class Path
{
	constructor(public readonly uri:Uri)
	{
	}

	public toString():string
	{
		throw Error('Blocked to find bug');
	}

	public get fsPath():string
	{
		return this.uri.fsPath;
	}

	workspace():Workspace
	{
		const workspaceFolder = workspace.getWorkspaceFolder(this.uri);
		if (!workspaceFolder) throw Error(this.fsPath+" is not in workspace");
		const fsworkspace = Workspace.getInstance(workspaceFolder);
		if (!fsworkspace) throw Error(this.fsPath+" ftp-kr is not inited");
		return fsworkspace;
	}

	/**
	 * path from workspace
	 */
	workpath():string
	{
		const workspacePath = this.workspace().fsPath;
		const fsPath = this.fsPath;
		if (fsPath.startsWith(workspacePath))
		{
			if (workspacePath.length === fsPath.length) return '';
			const workpath = fsPath.substr(workspacePath.length);
			if (workpath.startsWith(path.sep)) 
			{
				if (path.sep === '\\') return workpath.replace(/\\/g, '/').substr(1);
				if (path.sep !== '/') return workpath.replace(new RegExp(path.sep, 'g'), '/').substr(1);
				return workpath.substr(1);
			}
		}
		throw Error(`${fsPath} is not in workspace`);
	}

	in(parent:Path):boolean
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
	
	async children():Promise<Path[]>
	{
		const files = await util.callbackToPromise<string[]>((callback)=>fs.readdir(this.fsPath, callback));
		return files.map(filename=>this.child(filename));
	}

	static parse(pathname:string)
	{
		return new Path(Uri.file(pathname));
	}

	sibling(filename:string):Path
	{
		return Path.parse(path.join(path.dirname(this.uri.fsPath), filename));
	}

	child(...filename:string[]):Path
	{
		var i = filename.length;
		while (i--)
		{
			if (path.isAbsolute(filename[i]))
			{
				return Path.parse(path.join(...filename.slice(i)));
			}
		}
		return Path.parse(path.join(this.uri.fsPath, ...filename));
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

export interface WorkspaceItem
{
	dispose():void;
}

interface WorkspaceItemConstructor<T extends WorkspaceItem>
{
	new(workspace:Workspace):T;
}

interface ItemMap
{
	values():Iterable<WorkspaceItem>;
	get<T extends WorkspaceItem>(item:WorkspaceItemConstructor<T>):T|undefined;
	set<T extends WorkspaceItem>(item:WorkspaceItemConstructor<T>, T):void;
	clear():void;
}

export enum WorkspaceOpenState
{
	CREATED,
	OPENED
}

export class Workspace extends Path
{
	private static wsmap = new Map<string, Workspace>();
	private static wsloading = new Map<string, Workspace>();
	private readonly items:ItemMap = new Map;
	public readonly name:string;

	constructor(public readonly workspaceFolder:WorkspaceFolder, public readonly openState:WorkspaceOpenState)
	{
		super(workspaceFolder.uri);
		this.name = workspaceFolder.name;
	}

	public query<T extends WorkspaceItem>(type:WorkspaceItemConstructor<T>):T
	{
		var item = this.items.get(type);
		if (item === undefined)
		{
			item = new type(this);
			this.items.set(type, item);
		}
		return item;
	}

	private dispose():void
	{
		for(const item of this.items.values())
		{
			item.dispose();
		}
		this.items.clear();
		
	}

	static getInstance(workspace:WorkspaceFolder):Workspace|undefined
	{
		return Workspace.wsmap.get(workspace.uri.fsPath);
	}

	static createInstance(workspaceFolder:WorkspaceFolder):Workspace|undefined
	{
		const workspacePath = workspaceFolder.uri.fsPath;
		var fsws = Workspace.wsmap.get(workspacePath);
		if (fsws) return fsws;
		Workspace.wsloading.delete(workspacePath);
		fsws = new Workspace(workspaceFolder, WorkspaceOpenState.CREATED);
		Workspace.wsmap.set(workspacePath, fsws);
		onNewWorkspace.fire(fsws);
		return fsws;
	}

	static async load(workspaceFolder:WorkspaceFolder):Promise<void>
	{
		const fsws = new Workspace(workspaceFolder, WorkspaceOpenState.OPENED);
		const workspacePath = workspaceFolder.uri.fsPath;
		if (Workspace.wsloading.has(workspacePath)) return;
	
		Workspace.wsloading.set(workspacePath, fsws);
		const existed = await fsws.child('.vscode/ftp-kr.json').exists();
		
		if (!Workspace.wsloading.has(workspacePath)) return;
		Workspace.wsloading.delete(workspacePath);

		if (existed)
		{
			Workspace.wsmap.set(workspacePath, fsws);
			onNewWorkspace.fire(fsws);
		}
	}

	static unload(workspaceFolder:WorkspaceFolder):void
	{
		const workspacePath = workspaceFolder.uri.fsPath;
		Workspace.wsloading.delete(workspacePath);

		const ws = Workspace.wsmap.get(workspacePath);
		if (ws)
		{
			ws.dispose();
			Workspace.wsmap.delete(workspacePath);
		}
	}
	
	static loadAll():void
	{
		workspaceWatcher = workspace.onDidChangeWorkspaceFolders(e=>{
			for (const ws of e.added)
			{
				Workspace.load(ws);
			}
			for (const ws of e.removed)
			{
				Workspace.unload(ws);
			}
		});
		if (workspace.workspaceFolders)
		{
			for(const ws of workspace.workspaceFolders)
			{
				Workspace.load(ws);
			}
		}
	}

	static unloadAll():void
	{
		if (workspaceWatcher)
		{
			workspaceWatcher.dispose();
			workspaceWatcher = undefined;
		}
		for(const ws of Workspace.wsmap.values())
		{
			ws.dispose();
		}
		Workspace.wsmap.clear();
		Workspace.wsloading.clear();
	}


	static first():Workspace
	{
		if (workspace.workspaceFolders)
		{
			for (const ws of workspace.workspaceFolders)
			{
				const fsws = Workspace.wsmap.get(ws.uri.fsPath);
				if (!fsws) continue;
				return fsws;
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
				const fsws = Workspace.wsmap.get(ws.uri.fsPath);
				if (fsws) yield fsws;
			}
		}
	}
}

var workspaceWatcher:Disposable|undefined;

export const onNewWorkspace = event.make<Workspace>();
