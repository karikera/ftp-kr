
import { Event } from '../util/event';
import { workspace, Uri, WorkspaceFolder, ParameterInformation, Disposable, ExtensionContext } from 'vscode';
import { File } from 'krfile';


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
	get<T extends WorkspaceItem>(ctr:WorkspaceItemConstructor<T>):T|undefined;
	set<T extends WorkspaceItem>(ctr:WorkspaceItemConstructor<T>, item:T):void;
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
		super(workspaceFolder.uri.fsPath);
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
		Workspace.onNew.fire(fsws);
		return fsws;
	}

	static async load(workspaceFolder:WorkspaceFolder):Promise<void>
	{
		try
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
				await Workspace.onNew.fire(fsws);
			}
		}
		catch(err)
		{
			console.error(err);
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
	
	static one():Workspace|undefined
	{
		if (Workspace.wsmap.size === 1) return Workspace.wsmap.values().next().value;
		return undefined;
	}
	
	static fromFile(file:File):Workspace
	{
		const workspaceFolder = workspace.getWorkspaceFolder(Uri.file(file.fsPath));
		if (!workspaceFolder) throw Error(file.fsPath+" is not in workspace");
		const fsworkspace = Workspace.getInstance(workspaceFolder);
		if (!fsworkspace) throw Error(file.fsPath+" ftp-kr is not inited");
		return fsworkspace;
	}
	
	static readonly onNew = Event.make<Workspace>('onNew', false);
}

var workspaceWatcher:Disposable|undefined;
