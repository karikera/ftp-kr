
import { commands, StatusBarItem, window, workspace, Uri, TextEditor, TextDocument, Position, Selection, Range, TextDocumentShowOptions, ExtensionContext } from 'vscode';
import { File } from 'krfile';

import { Workspace, WorkspaceItem } from './ws';


var context:ExtensionContext|null = null;

export class StateBar implements WorkspaceItem
{
	private statebar:StatusBarItem|undefined;
	private disposed:boolean = false;
	
	constructor(workspace:Workspace)
	{
	}

	public dispose()
	{
		if (this.disposed) return;
		this.close();
		this.disposed = true;
	}

	public close()
	{
		if (this.statebar)
		{
			this.statebar.dispose();
			this.statebar = undefined;
		}
	}

	public set(state:string):void
	{
		if (this.disposed) return;
		if (!this.statebar) this.statebar = window.createStatusBarItem();
		this.statebar.text = state;
		this.statebar.show();
	}
}

export class QuickPickItem implements QuickPickItem
{
	public label: string = '';
	public description: string = '';
	public detail?: string;
	public onselect:()=>any = ()=>{};
}

export class QuickPick
{
	public items:QuickPickItem[] = [];
	public oncancel:()=>any = ()=>{};

	constructor()
	{
	}

	public clear()
	{
		this.items.length = 0;
	}
	
	public item(label:string, onselect:()=>Promise<any>|void):QuickPickItem
	{
		const item = new QuickPickItem();
		item.label = label;
		item.onselect = onselect;
		this.items.push(item);
		return item;
	}
	
	async open(placeHolder?:string):Promise<void>
	{
		const selected = await window.showQuickPick(this.items, {placeHolder});
		if (selected === undefined)
		{
			await this.oncancel();
		}
		else
		{
			await selected.onselect();
		}
	}

}

export const vsutil = {

	createWorkspace():Promise<Workspace|undefined>
	{
		return new Promise<Workspace|undefined>((resolve, reject)=>{
			const pick = new QuickPick;
			if (!workspace.workspaceFolders)
			{
				reject(Error("Need workspace"));
				return;
			}
			if (workspace.workspaceFolders.length === 1)
			{
				resolve(Workspace.createInstance(workspace.workspaceFolders[0]));
				return;
			}
			for(const workspaceFolder of workspace.workspaceFolders)
			{
				const fsws = Workspace.getInstance(workspaceFolder);
				var name = workspaceFolder.name;
				if (fsws) name += ' [inited]';
				pick.item(name, ()=>resolve(Workspace.createInstance(workspaceFolder)));
			}
			pick.oncancel = ()=>resolve(undefined);
			pick.open("Select Workspace");
		});
	},

	selectWorkspace():Promise<Workspace|undefined>
	{
		return new Promise<Workspace|undefined>((resolve, reject)=>{
			const pick = new QuickPick;
			for(const workspaceFolder of Workspace.all())
			{
				pick.item(workspaceFolder.name, ()=>resolve(workspaceFolder));
			}
			if (pick.items.length === 0)
			{
				reject(Error("Need workspace"));
				return;
			}
			if (pick.items.length === 1)
			{
				pick.items[0].onselect();
				return;
			}
			pick.oncancel = ()=>resolve(undefined);
			pick.open("Select Workspace");
		});
	},

	info(info:string, ...items:string[]):Thenable<string|undefined>
	{
		return window.showInformationMessage(info, ...items);
	},

	openWithError(path:File, message:string, line?:number, column?:number):Promise<TextEditor>
	{
		window.showErrorMessage(path + ": " + message);
		return vsutil.open(path, line, column);
	},

	async openUri(uri:Uri|string):Promise<void>
	{
		if (typeof uri === 'string') uri = Uri.parse(uri);
		const doc = await workspace.openTextDocument(uri);
		await window.showTextDocument(doc);
	},

	async open(path:File, line?:number, column?:number):Promise<TextEditor>
	{
		const doc = await workspace.openTextDocument(path.fsPath);
		const editor = await window.showTextDocument(doc);
		if (line !== undefined)
		{
			line --;
			if (column === undefined) column = 0;
			
			const pos = new Position(line, column);
			editor.selection = new Selection(pos, pos);
			editor.revealRange(new Range(pos, pos));		
		}
		return editor;
	},

	async openNew(content:string):Promise<TextDocument>
	{
		const doc = await workspace.openTextDocument({content});
		window.showTextDocument(doc);
		return doc;
	},

	diff(left:File, right:File, title?:string):Thenable<void>
	{
		return new Promise(resolve=>{
			const leftUri = Uri.file(left.fsPath);
			const rightUri = Uri.file(right.fsPath);
			var options:TextDocumentShowOptions;
			commands.executeCommand('vscode.diff', leftUri, rightUri, title).then((res)=>{
				
				const dispose = workspace.onDidCloseTextDocument(e=>{
					if (e.uri.fsPath === left.fsPath)
					{
						dispose.dispose();
						resolve();
						return;
					}
				});
			});
		});
	},

};