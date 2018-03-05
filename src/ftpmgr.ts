
import { window } from 'vscode';
import { File } from 'krfile';

import { FileInfo } from './util/fileinfo';
import { ServerConfig } from './util/serverinfo';

import { FileInterface } from './vsutil/fileinterface';
import { SftpConnection } from './vsutil/sftp';
import { FtpConnection } from './vsutil/ftp';
import { vsutil } from './vsutil/vsutil';
import { Logger } from './vsutil/log';
import { Workspace } from './vsutil/ws';
import { Task } from './vsutil/work';

import { Config } from './config';
import { ftp_path } from './util/ftp_path';
import { promiseErrorWrap } from './util/util';

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
					reject('BLOCKED');
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
				if (stopTimeout()) reject('CANCELLED');
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
			for (;;)
			{
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
					if (err !== 'BLOCKED') throw err;
					this.terminate();
					client = await this.connect(task);
				}
			}
		}));
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
	
		async function tryToConnect(password:string|undefined):Promise<void>
		{
			for (;;)
			{
				const client = createClient(that.workspace, config);
				try
				{
					that.logger.message(`Trying to connect to ${config.url} with user ${config.username}`);
					await that._blockTestWith(task, client.connect(password));
					client.log('Connected');
					that.client = client;
					return;
				}
				catch (err)
				{
					if (err !== 'BLOCKED') throw err;
					client.terminate();
				}
			}
		}
	
		async function tryToConnectOrErrorMessage(password:string|undefined):Promise<string|undefined>
		{
			try
			{
				await tryToConnect(password);
				return undefined;
			}
			catch(err)
			{
				var error:string;
				switch (err.code)
				{
				case 530:
					error = 'Authentication failed';
					break;
				default:
					switch (err.message)
					{
					case 'Login incorrect.':
					case 'All configured authentication methods failed':
						error = 'Authentication failed';
						break;
					default:
						that.terminate();
						throw err;
					}
					break;
				}
				that.logger.message(error);
				return error;
			}
		}
	
		if (!usepk && config.password === undefined)
		{
			var errorMessage:string|undefined;
			if (this.config.passwordInMemory !== undefined)
			{
				errorMessage = await tryToConnectOrErrorMessage(this.config.passwordInMemory);
				if (errorMessage !== undefined) throw Error(errorMessage);
			}
			else for (;;)
			{
				const promptedPassword = await window.showInputBox({
					prompt:'ftp-kr: '+(config.protocol||'').toUpperCase()+" Password Request",
					password: true,
					ignoreFocusOut: true,
					placeHolder: errorMessage
				});
				if (promptedPassword === undefined)
				{
					this.terminate();
					throw 'PASSWORD_CANCEL';
				}
				errorMessage = await tryToConnectOrErrorMessage(promptedPassword);
				if (errorMessage === undefined)
				{
					if (config.keepPasswordInMemory)
					{
						this.config.passwordInMemory = promptedPassword;
					}
					break;
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
	
	public view(task:Task, ftppath:string):Promise<string>
	{
		return this._blockTestWrap(task, client=>client.view(ftppath));
	}
	
	public list(task:Task, ftppath:string):Promise<FileInfo[]>
	{
		return this._blockTestWrap(task, client=>client.list(ftppath));
	}

	public readlink(task:Task, fileinfo:FileInfo, ftppath:string):Promise<string>
	{
		return this._blockTestWrap(task, client=>client.readlink(fileinfo, ftppath));
	}
}
