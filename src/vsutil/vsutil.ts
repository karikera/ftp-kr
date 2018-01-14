
import * as vscode from 'vscode';
import * as file from './file';

const window = vscode.window;
const workspace = vscode.workspace;

export class StateBar implements file.WorkspaceItem
{
	private statebar:vscode.StatusBarItem|undefined;
	private disposed:boolean = false;
	
	constructor(workspace:file.Workspace)
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

export function createWorkspace():Promise<file.Workspace|undefined>
{
	return new Promise<file.Workspace|undefined>((resolve, reject)=>{
		const pick = new QuickPick;
		if (!workspace.workspaceFolders)
		{
			reject(Error("Need workspace"));
			return;
		}
		if (workspace.workspaceFolders.length === 1)
		{
			resolve(file.Workspace.createInstance(workspace.workspaceFolders[0]));
			return;
		}
		for(const ws of workspace.workspaceFolders)
		{
			const fsws = file.Workspace.getInstance(ws);
			var name = ws.name;
			if (fsws) name += ' [inited]';
			pick.item(name, ()=>resolve(file.Workspace.createInstance(ws)));
		}
		pick.oncancel = ()=>resolve(undefined);
		pick.open("Select Workspace");
	});
}

export function selectWorkspace():Promise<file.Workspace|undefined>
{
	return new Promise<file.Workspace|undefined>((resolve, reject)=>{
		const pick = new QuickPick;
		for(const ws of file.Workspace.all())
		{
			pick.item(ws.name, ()=>resolve(ws));
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
}

export function fileOrEditorFile(uri: any): Promise<file.File> {
	try
	{
		if (uri instanceof vscode.Uri && uri.fsPath) { // file.fsPath is undefined when activated by hotkey
			const path = new file.File(uri);
			return Promise.resolve(path);
		}
		else {
			const editor = window.activeTextEditor;
			if (!editor) throw Error('No file selected');
			const doc = editor.document;
			const path = new file.File(doc.uri);
			return Promise.resolve().then(()=>doc.save()).then(()=>path);
		}
	}
	catch(e)
	{
		return Promise.reject(e);
	}
}

export function info(info:string, ...items:string[]):Thenable<string|undefined>
{
	return window.showInformationMessage(info, ...items);
}

export function openWithError(path:file.File, message:string, line?:number, column?:number):Promise<vscode.TextEditor>
{
	window.showErrorMessage(path + ": " + message);
	return open(path, line, column);
}

export class QuickPickItem implements vscode.QuickPickItem
{
	public label: string;
	public description: string = '';
	public detail?: string;
	public onselect:()=>any;
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
	
	public item(label:string, onselect:()=>any):QuickPickItem
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

export async function open(path:file.File, line?:number, column?:number):Promise<vscode.TextEditor>
{
	const doc = await workspace.openTextDocument(path.uri);
	const editor = await window.showTextDocument(doc);
	if (line !== undefined)
	{
		line --;
		if (column === undefined) column = 0;
		
		const pos = new vscode.Position(line, column);
		editor.selection = new vscode.Selection(pos, pos);
		editor.revealRange(new vscode.Range(pos, pos));		
	}
	return editor;
}

export async function openNew(content:string):Promise<vscode.TextDocument>
{
	const doc = await workspace.openTextDocument({content});
	window.showTextDocument(doc);
	return doc;
}
