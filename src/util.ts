
import * as vscode from "vscode";
import * as fs from './fs';
import stripJsonComments = require('strip-json-comments');

const window = vscode.window;
const workspace = vscode.workspace;

var output:vscode.OutputChannel|null = null;
var statebar:vscode.StatusBarItem|null = null;

export var context:vscode.ExtensionContext;

export type LogLevel = 'VERBOSE' | 'NORMAL';
enum LogLevelEnum
{
	VERBOSE,
	NORMAL
}

export var logLevel:LogLevelEnum = LogLevelEnum.NORMAL;

export function setLogLevel(level:LogLevel):void
{
	logLevel = LogLevelEnum[level];
}

export function setContext(ctx:vscode.ExtensionContext):void
{
	context = ctx;
}

export class Deferred<T>
{
	resolve:((v:T)=>void);
	reject:((v:T)=>void);
	promise:Promise<T> = new Promise<T>((res, rej)=>{
		this.resolve = res;
		this.reject = rej;
	});
	
	then(onfulfilled?:(v:T)=>T, onreject?:(v:any)=>T):Promise<T>
	{
		return this.promise.then(onfulfilled, onreject);
	}

	catch<T2>(func:(v:any)=>T2):Promise<T|T2>
	{
		return this.promise.catch(func);
	}
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

export function isEmptyObject(obj:Object):boolean
{
	for(var p in obj) return false;
	return true;
}

export function setState(state:string):void
{
	var bar;
	if (statebar) bar = statebar;
	else bar = statebar = window.createStatusBarItem();
	bar.text = state;
	bar.show();
}

function getOutput():vscode.OutputChannel
{
	if (output) return output;
	else return output = window.createOutputChannel("ftp-kr");
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

export function log(level:LogLevelEnum, ...message:string[]):void
{
	if (level < logLevel) return;
	const out = getOutput();
	out.appendLine(message.join(' '));
}

export function message(...message:string[]):void
{
	log(LogLevelEnum.NORMAL, ...message);
}

export function verbose(...message:string[]):void
{
	log(LogLevelEnum.VERBOSE, ...message);
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
	message(err.toString());
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
				message(output);
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
		message(err.toString());
	}
	else
	{
		msg = err;
		console.error(new Error(err));
		message(err);
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

export function parseJson(text:string):any
{
	try
	{
		return JSON.parse(stripJsonComments(text));
	}
	catch(err)
	{
		const regexp = /^(.+) JSON at position ([0-9]+)$/;
		if (regexp.test(err.message))
		{
			const pos = +RegExp.$2;
			const front = text.substring(0, pos);
			var line = 1;
			var lastidx = 0;
			for (;;)
			{
				const idx = front.indexOf('\n', lastidx);
				if (idx === -1) break;
				line ++;
				lastidx = idx + 1;
			}
			const column = pos - lastidx;
			err.message = `${RegExp.$1} JSON at line ${line}, column ${column}`;
		}
		throw err;
	}
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

export function addOptions(args:string[], options:Object):void
{
	for (const key in options)
	{
		const value = options[key];
		if (Array.isArray(value))
		{
			for (const val of value)
			{
				args.push("--" + key);
				args.push(val);
			}
			continue;
		}
		if (typeof value === 'boolean' && value === false)
		{
			continue;
		}
		args.push("--" + key);
		if (value !== true)
		{
			args.push(value);
		}
	}
}

export function merge<T>(original:T, overrider?:T, access?:T):T
{
	if (!overrider) return original;

    const conststr:string[] = [];
    const arrlist:string[][] = [];
	var nex:T;

    if(!access)
    {
        nex = original;
    }
    else
    {
		nex = access;
        for(var p in original) access[p] = original[p];
    }

    function convert(value:any):any
    {
        if (typeof value !== "string") return value;
        
        var nvalue = "";
        var i = 0;
        for(;;)
        {
            var j = value.indexOf("%", i);
            if (j === -1) break;
            var tx = value.substring(i, j);
            j++;
            var k = value.indexOf("%", j);
            if (k === -1) break;
            nvalue += tx;
            var varname = value.substring(j, k);
            if (varname in nex)
            {
                var val = nex[varname];
                if (val instanceof Array)
                {
                    if (val.length === 1)
                    {
                        nvalue += val[0];
                    }
                    else
                    {
                        conststr.push(nvalue);
                        nvalue = '';
                        arrlist.push(val);
                    }
                }
                else
                    nvalue += val;
            }
            else nvalue += "%" + varname + "%";
            i = k + 1;
        }

        nvalue += value.substr(i);
        if (arrlist.length !== 0)
        {
            conststr.push(nvalue);
            var from:string[][] = [conststr];
            var to:string[][] = [];
            for(var j=0;j<arrlist.length;j++)
            {
                const list = arrlist[j];
                for(var i=0; i<list.length;i++)
                {
                    for(var k=0;k<from.length;k++)
                    {
                        const cs = from[k];
                        const ncs = cs.slice(1, cs.length);
                        ncs[0] = cs[0] + list[i] + cs[1];
                        to.push(ncs);
                    }
                }
                var t = to;
                to = from;
                from = t;
                to.length = 0;
            }
            return from.map(v=>v[0]);
        }
        return nvalue;
    }

    var out:T = <T>{};

    for(var p in overrider)
    {
        var value = overrider[p];
		if (value instanceof Array)
        {
            const nvalue:any[] = [];
            for(let val of value)
            {
                val = convert(val);
                if (val instanceof Array) nvalue.push(nvalue, ...val);
                else nvalue.push(val);
            }
            out[p] = <any>nvalue;
        }
		else if (value instanceof Object)
		{
			const ori = original[p];
			if (ori instanceof Object)
			{
				out[p] = merge(ori, value, <any>nex[p]);
			}
			else
			{
				out[p] = value;
			}
		}
        else
        {
            out[p] = convert(value);
        }
    }
    for(const p in original)
    {
        if (p in out) continue;
        out[p] = original[p];
    }
    return out;
}
