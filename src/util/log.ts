
import * as fs from './fs';
import { OutputChannel, window } from 'vscode';
import * as vsutil from './vsutil';

export type Level = 'VERBOSE' | 'NORMAL' | 'ERROR';
enum LogLevelEnum
{
	VERBOSE,
	NORMAL,
	ERROR,
}


export class Logger
{
	public logLevel:LogLevelEnum = LogLevelEnum.NORMAL;
	private output:OutputChannel|null = null;
	public readonly name:string;
	public static all:Set<Logger> = new Set;

	constructor(name:string|fs.Workspace)
	{
		if (name instanceof fs.Workspace)
		{
			this.name = name.name+".ftp-kr";
		}
		else
		{
			this.name = name;
		}
		Logger.all.add(this);
	}	
	
	private getOutput():OutputChannel
	{
		if (this.output) return this.output;
		else return this.output = window.createOutputChannel(this.name);
	}

	private print(message:string):void
	{
		const channel = this.getOutput();
		channel.appendLine(message);
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
		this.verbose(`${this.name}.logLevel = ${level}`);

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
			defaultLogger.verbose(`${defaultLogger.name}.logLevel = ${LogLevelEnum[minLevel]}`);
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
		console.error(err);
		this.log(LogLevelEnum.ERROR, err.toString());
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
				
				const logfile = this.workspace.child('.vscode/ftp-kr.error.log');
				logfile.create(output)
				.then(()=>logfile.open())
				.catch(()=>{
					this.show();
					this.log(LogLevelEnum.ERROR, output);
				});
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

	public wrap(workspace:fs.Workspace, func:()=>void):void
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
		const out = this.getOutput();
		out.show();
	}

	public clear():void 
	{
		const out = this.output;
		if (!out) return;
		out.clear();
	}

	public dispose()
	{
		const out = this.output;
		if (!out) return;
		out.dispose();
		this.output = null;
		Logger.all.delete(this);
	}

}

export const defaultLogger:Logger = new Logger('ftp-kr');
