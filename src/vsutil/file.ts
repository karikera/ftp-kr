
import * as fs from 'fs';
import * as path from 'path';
import UtilFile from '../util/file';
import * as util from '../util/util';
import * as event from '../util/event';
import glob from '../util/pglob';
import { workspace, Uri, WorkspaceFolder, ParameterInformation, Disposable, ExtensionContext } from 'vscode';

export type Stats = fs.Stats;

export class File extends UtilFile
{
	constructor(public readonly uri:Uri)
	{
		super(uri.fsPath);
	}

	public toString():string
	{
		throw Error('Blocked to find bug');
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

	async children():Promise<File[]>
	{
		const files = await util.callbackToPromise<string[]>((callback)=>fs.readdir(this.fsPath, callback));
		return files.map(filename=>this.child(filename));
	}

	static parse(pathname:string)
	{
		return new File(Uri.file(pathname));
	}

	sibling(filename:string):File
	{
		return File.parse(path.join(path.dirname(this.uri.fsPath), filename));
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
		return File.parse(path.join(this.uri.fsPath, ...filename));
	}

	parent():File
	{
		return File.parse(path.dirname(this.uri.fsPath));
	}

	async glob():Promise<File[]>
	{
		const files = await glob(this.fsPath);
		return files.map(path=>File.parse(path));
	}

	static async glob(path:File[]):Promise<File[]>
	{
		const narr:File[] = [];
		narr.length = path.length;
		for (var i=0;i<path.length;i++)
		{
			const list = await path[i].glob();
			narr.push(... list);
		}
		return narr;
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

export class Workspace extends File
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
