
import * as vscode from 'vscode';
import * as log from './util/log';
import * as fs from './util/fs';

const window = vscode.window;
const workspace = vscode.workspace;

var output:vscode.OutputChannel|null = null;
var statebar:vscode.StatusBarItem|null = null;

export var context:vscode.ExtensionContext;

function getOutput():vscode.OutputChannel
{
	if (output) return output;
	else return output = window.createOutputChannel("ftp-kr");
}

export function setContext(ctx:vscode.ExtensionContext):void
{
	context = ctx;
}

export function fileOrEditorFile(file: vscode.Uri): Promise<string> {
	try
	{
		if (file && file.fsPath) { // file.fsPath is undefined when activated by hotkey
			const path = fs.worklize(file.fsPath);
			return Promise.resolve(path);
		}
		else {
			const editor = window.activeTextEditor;
			if (!editor) throw Error('No file selected');
			const doc = editor.document;
			const path = fs.worklize(doc.fileName);
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

export function clearLog():void 
{
	const out = output;
	if (!out) return;
	out.clear();
}

export function showLog():void
{
	const out = getOutput();
	out.show();
}

export function print(message:string):void
{
	const channel = getOutput();
	channel.appendLine(message);
}

export function wrap(func:()=>void):void
{
	try
	{
		func();
	}
	catch(err)
	{
		error(err);
	}
}

export function info(info:string, ...items:string[]):Thenable<string>
{
	return window.showInformationMessage(info, ...items);
}

export function error(err:NodeJS.ErrnoException|string):void
{
	console.error(err);
	log.message(err.toString());
	if (err instanceof Error)
	{
		window.showErrorMessage(err.message, 'Detail')
		.then(function(res){
			if (res !== 'Detail') return;
			var output = '[';
			output += err.constructor.name;
			output += ']\nmessage: ';
			output += err.message;
			if (err.code)
			{
				output += '\ncode: ';
				output += err.code;
			}
			if (err.errno)
			{
				output += '\nerrno: ';
				output += err.errno;
			}
			output += '\n[Stack Trace]\n';
			output += err.stack;
			
			const LOGFILE = '/.vscode/ftp-kr.error.log';
			fs.create(LOGFILE, output)
			.then(()=>open(LOGFILE))
			.catch(()=>{
				showLog();
				log.message(output);
			});
		});
	}
	else
	{
		window.showErrorMessage(err.toString());
	}
}

export function errorConfirm(err:Error|string, ...items:string[]):Thenable<string>
{
	var msg:string;
	if (err instanceof Error)
	{
		msg = err.message;
		console.error(err);
		log.message(err.toString());
	}
	else
	{
		msg = err;
		console.error(new Error(err));
		log.message(err);
	}

	return window.showErrorMessage(msg, ...items);
}

export function openWithError(path:string, message:string, line?:number, column?:number):Promise<vscode.TextEditor>
{
	window.showErrorMessage(path + ": " + message);
	return open(path, line, column);
}

export function select(list:string[]|Promise<string[]>):Thenable<string>
{
	return window.showQuickPick(list);
}

export async function open(path:string, line?:number, column?:number):Promise<vscode.TextEditor>
{
	const doc = await workspace.openTextDocument(fs.workspace + path);
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
