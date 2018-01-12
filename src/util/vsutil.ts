
import * as vscode from 'vscode';
import * as fs from './fs';

const window = vscode.window;
const workspace = vscode.workspace;

var statebar:vscode.StatusBarItem|null = null;

export var context:vscode.ExtensionContext;

export function setContext(ctx:vscode.ExtensionContext):void
{
	context = ctx;
}

export function selectWorkspace():Promise<fs.Workspace|null>
{
	return new Promise<fs.Workspace|null>((resolve, reject)=>{
		const pick = new QuickPick;
		for(const ws of fs.Workspace.all())
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
		pick.oncancel = ()=>resolve(null);
		pick.open("Select Workspace");
	});
}

export function fileOrEditorFile(file: any): Promise<fs.Path> {
	try
	{
		if (file instanceof vscode.Uri && file.fsPath) { // file.fsPath is undefined when activated by hotkey
			const path = new fs.Path(file);
			return Promise.resolve(path);
		}
		else {
			const editor = window.activeTextEditor;
			if (!editor) throw Error('No file selected');
			const doc = editor.document;
			const path = new fs.Path(doc.uri);
			return Promise.resolve().then(()=>doc.save()).then(()=>path);
		}
	}
	catch(e)
	{
		return Promise.reject(e);
	}
}

export function setState(state:string):void
{
	var bar;
	if (statebar) bar = statebar;
	else bar = statebar = window.createStatusBarItem();
	bar.text = state;
	bar.show();
}

export function info(info:string, ...items:string[]):Thenable<string|undefined>
{
	return window.showInformationMessage(info, ...items);
}

export function openWithError(path:fs.Path, message:string, line?:number, column?:number):Promise<vscode.TextEditor>
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
	
	public item(label:string, onselect:()=>any=()=>{}):QuickPickItem
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

export async function open(path:fs.Path, line?:number, column?:number):Promise<vscode.TextEditor>
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
