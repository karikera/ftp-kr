
import { OutputChannel, window } from 'vscode';
import { WorkspaceItem, Workspace } from './ws';
import { vsutil } from './vsutil';
import { LogLevel } from '../util/serverinfo';
import { getMappedStack } from '../util/sm';

enum LogLevelEnum
{
	VERBOSE,
	NORMAL,
	ERROR,
}


export class Logger implements WorkspaceItem
{
	public logLevel:LogLevelEnum = LogLevelEnum.NORMAL;
	private output:OutputChannel|null = null;
	public static all:Set<Logger> = new Set;
	private task:Promise<void> = Promise.resolve();

	constructor(name:string|Workspace)
	{
		if (name instanceof Workspace)
		{
			name = "ftp-kr/" + name.name;
		}
		this.output = window.createOutputChannel(name);
		Logger.all.add(this);
	}
	
	private logRaw(level:LogLevelEnum, ...message:string[]):void
	{
		if (level < this.logLevel) return;
		if (!this.output) return;
		switch (this.logLevel)
		{
		case LogLevelEnum.VERBOSE:
			this.output.appendLine(LogLevelEnum[level]+': '+message.join(' ').replace(/\n/g, '\nVERBOSE: '));
			break;
		default:
			this.output.appendLine(message.join(' '));
			break;
		}
	}
	private log(level:LogLevelEnum, ...message:string[]):Promise<void>
	{
		return this.task = this.task.then(()=>this.logRaw(level, ...message));
	}
	
	public setLogLevel(level:LogLevel):void
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
		
	public error(err:any):Promise<void>
	{
		return this.task = this.task.then(async()=>{
			if (err === 'IGNORE') return;
			const stack = await getMappedStack(err);
			if (stack)
			{
				console.error(stack);
				this.logRaw(LogLevelEnum.ERROR, stack);
				const res = await window.showErrorMessage(err.message, 'Detail');
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
				output += stack;
				vsutil.openNew(output);
			}
			else
			{
				console.error(err);
				const errString = err.toString();
				this.logRaw(LogLevelEnum.ERROR, errString);
				window.showErrorMessage(errString);
			}
		});
	}

	public errorConfirm(err:Error|string, ...items:string[]):Thenable<string|undefined>
	{
		var msg:string;
		var error:Error;
		if (err instanceof Error)
		{
			msg = err.message;
			error = err;
		}
		else
		{
			msg = err;
			error = Error(err);
		}
		
		this.task = this.task
		.then(()=>getMappedStack(error))
		.then(stack=>this.logRaw(LogLevelEnum.ERROR, stack));

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
