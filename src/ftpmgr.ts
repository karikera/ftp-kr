
import { File } from 'krfile';
import { window } from 'vscode';

import { FileInfo } from './util/fileinfo';
import { ServerConfig } from './util/serverinfo';

import { FileInterface, FtpErrorCode } from './vsutil/fileinterface';
import { FtpConnection } from './vsutil/ftp';
import { Logger, StringError } from './vsutil/log';
import { SftpConnection } from './vsutil/sftp';
import { vsutil } from './vsutil/vsutil';
import { Task } from './vsutil/work';
import { Workspace } from './vsutil/ws';

import { Config } from './config';
import { promiseErrorWrap } from './util/util';
import { ftp_path } from './util/ftp_path';

function createClient(workspace:Workspace, config:ServerConfig):FileInterface
{
	var newclient:FileInterface;
	switch (config.protocol)
	{
	case 'sftp': newclient = new SftpConnection(workspace, config); break;
	case 'ftp': newclient = new FtpConnection(workspace, config); break;
	case 'ftps': newclient = new FtpConnection(workspace, config); break;
	default: throw Error(`Invalid protocol ${config.protocol}`);
	}
	return newclient;
}

export enum LoadError {
	NOTFOUND='NOTFOUND',
	CONNECTION_FAILED='CONNECTION_FAILED',
	PASSWORD_CANCEL='PASSWORD_CANCEL',
	AUTH_FAILED='AUTH_FAILED',
}

export function getLoadErrorMessage(err:LoadError):string {
	switch (err) {
	case LoadError.NOTFOUND: return 'Not Found';
	case LoadError.CONNECTION_FAILED: return 'Connection Failed';
	case LoadError.PASSWORD_CANCEL: return 'Password Cancel';
	case LoadError.AUTH_FAILED: return 'Authentication Failed. Invalid username or password';
	}
}

export class FtpManager
{
	private client:FileInterface|null = null;
	private connectionInfo:string = '';
	private destroyTimeout:NodeJS.Timer|null = null;
	private cancelBlockedCommand:(()=>void)|null = null;
	private currentTask:Task|null = null;
	private connected:boolean = false;
	public home:string = '';
	
	private readonly logger:Logger;

	constructor(public readonly workspace:Workspace, public readonly config:ServerConfig)
	{
		this.logger = workspace.query(Logger);
	}

	private _cancelDestroyTimeout():void
	{
		if (!this.destroyTimeout)
			return;

		clearTimeout(this.destroyTimeout);
		this.destroyTimeout = null;
	}

	private _updateDestroyTimeout():void
	{
		this._cancelDestroyTimeout();
		this.destroyTimeout = setTimeout(()=>this.disconnect(), this.config.connectionTimeout);
	}

	private _cancels():void
	{
		this._cancelDestroyTimeout();
		if (this.cancelBlockedCommand)
		{
			this.cancelBlockedCommand();
			this.cancelBlockedCommand = null;
			this.currentTask = null;
		}
	}

	private _makeConnectionInfo():string
	{
		const config = this.config;
		const usepk = config.protocol === 'sftp' && !!config.privateKey;
		const datas = [
			config.protocol,
			config.username,
			config.password,
			config.host,
			config.port,
			usepk,
			usepk ? config.privateKey : '',
			usepk ? config.passphrase : ''
		];
		return JSON.stringify(datas);
	}

	private _blockTestWith<T>(task:Task, prom:Promise<T>):Promise<T>
	{
		return task.with(new Promise<T>((resolve, reject)=>{
			if (this.cancelBlockedCommand)
			{
				const taskname = this.currentTask ? this.currentTask.name : 'none';
				throw Error(`Multiple order at same time (previous: ${taskname}, current: ${task.name})`);
			}
			var blockTimeout:NodeJS.Timer|null = setTimeout(()=>{
				if (blockTimeout)
				{
					this.cancelBlockedCommand = null;
					this.currentTask = null;
					blockTimeout = null;
					const timeoutError = Error('timeout');
					timeoutError.ftpCode = FtpErrorCode.REUQEST_RECONNECT_AND_RETRY;
					reject(timeoutError);
				}
			}, this.config.blockDetectingDuration);
			const stopTimeout = ()=>{
				if (blockTimeout)
				{
					this.cancelBlockedCommand = null;
					this.currentTask = null;
					clearTimeout(blockTimeout);
					blockTimeout = null;
					return true;
				}
				return false;
			};
			this.currentTask = task;
			this.cancelBlockedCommand = ()=>{
				if (stopTimeout()) reject(StringError.TASK_CANCEL);
			};
			
			prom.then(t=>{
				if (stopTimeout()) resolve(t);
			}, err=>{
				if (stopTimeout()) reject(err);
			});
		}));
	}
	
	private _blockTestWrap<T>(task:Task, callback:(client:FileInterface)=>Promise<T>)
	{
		return promiseErrorWrap(this.connect(task).then(async(client)=>{
			let tryCount = 0;
			for (;;) {
				tryCount = tryCount+1|0;
				this._cancelDestroyTimeout();
				try
				{
					const t = await this._blockTestWith(task, callback(client));
					this._updateDestroyTimeout();
					return t;
				}
				catch(err)
				{
					this._updateDestroyTimeout();
					if (err.ftpCode === FtpErrorCode.REUQEST_RECONNECT_AND_RETRY_ONCE) {
						this.terminate();
						client = await this.connect(task);
						if (tryCount >= 2) throw StringError.TASK_CANCEL;
					}
					else if (err.ftpCode === FtpErrorCode.REUQEST_RECONNECT_AND_RETRY) {
						this.terminate();
						client = await this.connect(task);
					} else {
						throw err;
					}
				}
			}
		}));
	}

	public resolvePath(ftppath:string):string {
		if (ftppath.startsWith('/')) {
			return ftp_path.normalize(ftppath);
		} else {
			return ftp_path.normalize(this.home + '/' + ftppath);
		}
	}

	public disconnect():void
	{
		this._cancels();

		if (this.client)
		{
			if (this.connected)
			{
				this.client.log('Disconnected');
				this.connected = false;
			}
			this.client.disconnect();
			this.client = null;
		}
	}

	public terminate():void
	{
		this._cancels();

		if (this.client)
		{
			if (this.connected)
			{
				this.client.log('Disconnected');
				this.connected = false;
			}
			this.client.terminate();
			this.client = null;
		}
	}

	public async connect(task:Task):Promise<FileInterface>
	{
		const that = this;
		const coninfo = this._makeConnectionInfo();
		if (this.client)
		{
			if (coninfo === this.connectionInfo)
			{
				this._updateDestroyTimeout();
				return Promise.resolve(this.client);
			}
			this.terminate();
			this.config.passwordInMemory = undefined;
		}
		this.connectionInfo = coninfo;
		
		const config = this.config;
		const usepk = config.protocol === 'sftp' && !!config.privateKey;
	
		async function tryToConnect(password:string|undefined):Promise<void> {
			try {
				for (;;) {
					const client = createClient(that.workspace, config);
					try {
						that.logger.message(`Trying to connect to ${config.url} with user ${config.username}`);
						await that._blockTestWith(task, client.connect(password));
						client.log('Connected');
						that.client = client;
						return;
					} catch (err) {
						switch (err.ftpCode) {
						case FtpErrorCode.REUQEST_RECONNECT_AND_RETRY:
							client.terminate();
							break;
						case FtpErrorCode.CONNECTION_REFUSED:
							throw LoadError.CONNECTION_FAILED;
						case FtpErrorCode.AUTH_FAILED:
							throw LoadError.AUTH_FAILED;
						default:
							throw err;
						}
					}
				}
			} catch (err) {
				that.terminate();
				throw err;
			}
		}
	
		if (!usepk && config.password === undefined) {
			if (this.config.passwordInMemory !== undefined) {
				await tryToConnect(this.config.passwordInMemory);
				if (task.cancelled) {
					this.terminate();
					throw StringError.TASK_CANCEL;
				}
			} else {
				let errorMessage:string|undefined;
				for (;;) {
					const promptedPassword = await window.showInputBox({
						prompt:'ftp-kr: '+(config.protocol||'').toUpperCase()+" Password Request",
						password: true,
						ignoreFocusOut: true,
						placeHolder: errorMessage
					});
					if (task.cancelled) {
						this.terminate();
						throw StringError.TASK_CANCEL;
					}
					if (promptedPassword === undefined) {
						this.terminate();
						throw LoadError.PASSWORD_CANCEL;
					}
					try {
						await tryToConnect(promptedPassword);
						if (config.keepPasswordInMemory) {
							this.config.passwordInMemory = promptedPassword;
						}
						break;
					} catch (err) {
						switch (err) {
						case LoadError.AUTH_FAILED:
							errorMessage = getLoadErrorMessage(err);
							break;
						default:
							throw err;
						}
					}
				}
			}
		}
		else
		{
			try
			{
				await tryToConnect(config.password);
			}
			catch (err) {
				this.terminate();
				throw err;
			}
		}
		
		if (!this.client) throw Error('Client is not created');
		this.client.oninvalidencoding = (errfiles:string[])=>{
			this.logger.errorConfirm("Invalid encoding detected. Please set fileNameEncoding correctly\n"+errfiles.join('\n'), 'Open config', 'Ignore after')
			.then((res)=>{
				switch(res)
				{
				case 'Open config': vsutil.open(this.workspace.query(Config).path); break; 
				case 'Ignore after':
					return this.workspace.query(Config).modifySave(cfg=>cfg.ignoreWrongFileEncoding=true);
				}
			});
		};
		this.home = await this.client.pwd();
		if (this.home === '/') this.home = '';

		this._updateDestroyTimeout();
		return this.client;
	}
	
	public rmdir(task:Task, ftppath:string):Promise<void>
	{
		return this._blockTestWrap(task, client=>client.rmdir(ftppath));
	}
	
	public remove(task:Task, ftppath:string):Promise<void>
	{
		return this._blockTestWrap(task, client=>client.delete(ftppath));
	}
	
	public mkdir(task:Task, ftppath:string):Promise<void>
	{
		return this._blockTestWrap(task, client=>client.mkdir(ftppath));
	}
	
	public upload(task:Task, ftppath:string, localpath:File):Promise<void>
	{
		return this._blockTestWrap(task, client=>client.upload(ftppath, localpath));
	}
	
	public download(task:Task, localpath:File, ftppath:string):Promise<void>
	{
		return this._blockTestWrap(task, client=>client.download(localpath, ftppath));
	}
	
	public view(task:Task, ftppath:string):Promise<Buffer>
	{
		return this._blockTestWrap(task, client=>client.view(ftppath));
	}
	
	public write(task:Task, ftppath:string, content:Buffer):Promise<void>
	{
		return this._blockTestWrap(task, client=>client.write(ftppath, content));
	}
	
	public list(task:Task, ftppath:string):Promise<FileInfo[]>
	{
		return this._blockTestWrap(task, client=>client.list(ftppath));
	}

	public readlink(task:Task, fileinfo:FileInfo, ftppath:string):Promise<string>
	{
		return this._blockTestWrap(task, client=>client.readlink(fileinfo, ftppath));
	}

	public rename(task:Task, ftppathFrom:string, ftppathTo:string):Promise<void>
	{
		return this._blockTestWrap(task, client=>client.rename(ftppathFrom, ftppathTo));
	}
}
