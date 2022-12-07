
import { OutputChannel, window } from 'vscode';
import { WorkspaceItem, Workspace } from './ws';
import { vsutil } from './vsutil';
import { LogLevel } from '../util/serverinfo';
import { getMappedStack } from '../util/sm';
import * as os from 'os';
import { File } from 'krfile';
import { replaceErrorUrl } from '../util/util';
import { parseJson } from 'krjson';

enum LogLevelEnum
{
	VERBOSE,
	NORMAL,
	ERROR,
}

export enum StringError {
	TASK_CANCEL='TASK_CANCEL',
	IGNORE='IGNORE',
}

export class Logger implements WorkspaceItem
{
	public logLevel:LogLevelEnum = LogLevelEnum.NORMAL;
	public dontOpen:boolean = false;
	private output:OutputChannel|null = null;
	private workspace:Workspace|null = null;
	public static all:Set<Logger> = new Set;
	private task:Promise<void> = Promise.resolve();
	private readonly _onError = async(err:unknown)=>{
		const stack = await getMappedStack(err);
		if (stack !== null) {
			console.error(stack);
			this.logRaw(LogLevelEnum.ERROR, stack);
		} else {
			console.error(err);
			this.logRaw(LogLevelEnum.ERROR, err+'');
		}
	};

	constructor(name:string|Workspace)
	{
		if (name instanceof Workspace)
		{
			this.workspace = name;
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
		return this.task = this.task.then(()=>this.logRaw(level, ...message)).catch(this._onError);
	}
	
	public setLogLevel(level:LogLevel):void
	{
		const oldlevel = this.logLevel;
		this.logLevel = LogLevelEnum[level];
		this.verbose(`logLevel = ${level}`);

		if (oldlevel === defaultLogger.logLevel)
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
	
	public message(...message:string[]):void {
		this.log(LogLevelEnum.NORMAL, ...message);
	}
	
	public verbose(...message:string[]):void {
		this.log(LogLevelEnum.VERBOSE, ... message);
	}
		
	public error(err:unknown):Promise<void> {
		return this.task = this.task.then(async()=>{
			if (err === StringError.IGNORE) return;
			let stack = await getMappedStack(err);
			if (stack !== null) {
				const error = err as any;
				console.error(stack);
				this.logRaw(LogLevelEnum.ERROR, stack);
				const res = await window.showErrorMessage(error.message, {modal: true}, 'Detail');
				if (res !== 'Detail') return;
				var output = '[ftp-kr Reporting]\n';
				if (error.task) {
					output += `Task: ${error.task}\n`;
				}
				const pathRemap:string[] = [];
				pathRemap.push(new File(__dirname).parent().parent().fsPath, '[ftp-kr]');
				if (this.workspace) {
					pathRemap.push(this.workspace.fsPath, `[workspace]`);
				}
				output += `platform: ${os.platform()}\n`;
				output += `arch: ${os.arch()}\n\n`;
				output += `[${error.constructor.name}]\nmessage: ${error.message}`;
				if (error.code) {
					output += `\ncode: ${error.code}`;
				}
				if (error.errno) {
					output += `\nerrno: ${error.errno}`;
				}
				
				function repath(path:string):string {
					for (var i=0;i<pathRemap.length;i+=2) {
						const prevPath = pathRemap[i];
						if (path.startsWith(prevPath)) {
							return pathRemap[i+1] + path.substr(prevPath.length);
						}
					}
					return path;
				}

				function filterAllField(value:any):any {
					if (typeof value === 'string') {
						return repath(value);
					}
					if (typeof value === 'object') {
						if (value instanceof Array) {
							for (var i=0;i<value.length;i++) {
								value[i] = filterAllField(value[i]);
							}
						} else {
							for (const name in value) {
								value[name] = filterAllField(value[name]);
							}
							
							if ("host" in value) {
								const type = typeof value.host;
								if (type === 'string') value.host = value.host.replace(/[a-zA-Z]/g, '*');
								else value.host = '['+type+']';
							}
							if ("privateKey" in value) {
								const type = typeof value.privateKey;
								if (type === 'string') value.privateKey = value.privateKey.replace(/[a-zA-Z]/g, '*');
								else value.privateKey = '['+type+']';
							}
							if ("password" in value) {
								const type = typeof value.password;
								if (type === 'string') value.password = '********';
								else value.password = '['+type+']';
							}
							if ("passphrase" in value) {
								const type = typeof value.passphrase;
								if (type === 'string') value.passphrase = '********';
								else value.passphrase = '['+type+']';
							}
						}
					}
					return value;
				}

				stack = replaceErrorUrl(stack, (path, line, column)=>`${repath(path)}:${line}:${column}`);
				output += `\n\n[Stack Trace]\n${stack}\n`;

				if (this.workspace)
				{
					output += '\n[ftp-kr.json]\n';
					const ftpkrjson = this.workspace.child('.vscode/ftp-kr.json');
					try
					{
						const readedjson = await ftpkrjson.open();
						try
						{
							const obj = filterAllField(parseJson(readedjson));
							output += JSON.stringify(obj, null, 4);
						}
						catch (err)
						{
							output += 'Cannot Parse: '+err+'\n';
							output += readedjson;
						}
					}
					catch (err)
					{
						output += 'Cannot Read: '+err+'\n';
					}
				}
				
				vsutil.openNew(output);
			}
			else
			{
				console.error(err);
				const errString = err+'';
				this.logRaw(LogLevelEnum.ERROR, errString);
				await window.showErrorMessage(errString, {modal: true});
			}
		}).catch(this._onError);
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
		.then(async()=>{
			const stack = await getMappedStack(error);
			this.logRaw(LogLevelEnum.ERROR, stack || error+'');
		});

		return window.showErrorMessage(msg, {
			modal: true,
		}, ...items);
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
		if (this.dontOpen) return;
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
