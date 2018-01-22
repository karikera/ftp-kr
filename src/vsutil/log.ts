
import * as ws from './ws';
import { OutputChannel, window } from 'vscode';
import * as vsutil from './vsutil';

export type Level = 'VERBOSE' | 'NORMAL' | 'ERROR';
enum LogLevelEnum
{
	VERBOSE,
	NORMAL,
	ERROR,
}


export class Logger implements ws.WorkspaceItem
{
	public logLevel:LogLevelEnum = LogLevelEnum.NORMAL;
	private output:OutputChannel|null = null;
	public static all:Set<Logger> = new Set;

	constructor(name:string|ws.Workspace)
	{
		if (name instanceof ws.Workspace)
		{
			name = "ftp-kr/" + name.name;
		}
		this.output = window.createOutputChannel(name);
		Logger.all.add(this);
	}
	
	private print(message:string):void
	{
		if (!this.output) return;
		this.output.appendLine(message);
	}

	private log(level:LogLevelEnum, ...message:string[]):void
	{
		if (level < this.logLevel) return;
		switch (this.logLevel)
		{
		case LogLevelEnum.VERBOSE:
			this.print(LogLevelEnum[level]+': '+message.join(' ').replace(/\n/g, '\nVERBOSE: '));
			break;
		default:
			this.print(message.join(' '));
			break;
		}
	}
	
	public setLogLevel(level:Level):void
	{
		this.logLevel = LogLevelEnum[level];
		this.verbose(`logLevel = ${level}`);

		if (this.logLevel === defaultLogger.logLevel)
		{
			var minLevel = LogLevelEnum.ERROR;
			for (const logger of Logger.all)
			{
				if (logger.logLevel < minLevel)
				{
					minLevel = logger.logLevel;
				}
			}
			defaultLogger.logLevel = minLevel;
		}
	}
	
	public message(...message:string[]):void
	{
		this.log(LogLevelEnum.NORMAL, ...message);
	}
	
	public verbose(...message:string[]):void
	{
		this.log(LogLevelEnum.VERBOSE, ... message);
	}
		
	public error(err:NodeJS.ErrnoException|string):void
	{
		if (err === 'IGNORE') return;
		console.error(err);
		this.log(LogLevelEnum.ERROR, err.toString());
		if (err instanceof Error)
		{
			window.showErrorMessage(err.message, 'Detail')
			.then(res=>{
				if (res !== 'Detail') return;
				var output = '';
				if (err.task)
				{
					output += 'Task: ';
					output += err.task;
					output += '\n';
				}
				output += '[';
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
				vsutil.openNew(output);
			});
		}
		else
		{
			window.showErrorMessage(err.toString());
		}
	}

	public errorConfirm(err:Error|string, ...items:string[]):Thenable<string|undefined>
	{
		var msg:string;
		if (err instanceof Error)
		{
			msg = err.message;
			console.error(err);
			this.log(LogLevelEnum.ERROR, err.toString());
		}
		else
		{
			msg = err;
			console.error(new Error(err));
			this.log(LogLevelEnum.ERROR, err);
		}

		return window.showErrorMessage(msg, ...items);
	}

	public wrap(func:()=>void):void
	{
		try
		{
			func();
		}
		catch(err)
		{
			this.error(err);
		}
	}

	public show():void
	{
		if (!this.output) return;
		this.output.show();
	}

	public clear():void 
	{
		const out = this.output;
		if (!out) return;
		out.clear();
	}

	public dispose():void
	{
		const out = this.output;
		if (!out) return;
		out.dispose();
		this.output = null;
		Logger.all.delete(this);
	}

}

export const defaultLogger:Logger = new Logger('ftp-kr');
