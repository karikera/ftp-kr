
import * as ssh2 from 'ssh2';
import * as path from 'path';
import * as vscode from 'vscode';
import * as util from './util/util';
import File from './util/file';

import * as ws from './vsutil/ws';
import * as log from './vsutil/log';
import * as work from './vsutil/work';
import * as vsutil from './vsutil/vsutil';

import * as cfg from './config';
import * as stream from 'stream';
import { FileInterface, ServerConfig, FileInfo } from './vsutil/fileinterface';
import { SftpConnection } from './vsutil/sftp';
import { FtpConnection } from './vsutil/ftp';

function createClient(workspace:ws.Workspace, config:ServerConfig):FileInterface
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
	client:FileInterface|null = null;

	private connectionInfo:string = '';
	private destroyTimeout:NodeJS.Timer|null = null;
	private cancelBlockedCommand:(()=>void)|null = null;
	private connected:boolean = false;
	
	private readonly logger:log.Logger;

	constructor(public readonly workspace:ws.Workspace, public readonly config:ServerConfig)
	{
		this.logger = workspace.query(log.Logger);
	}

	private cancelDestroyTimeout():void
	{
		if (!this.destroyTimeout)
			return;

		clearTimeout(this.destroyTimeout);
		this.destroyTimeout = null;
	}

	private updateDestroyTimeout():void
	{
		this.cancelDestroyTimeout();
		this.destroyTimeout = setTimeout(()=>this.destroy(), this.config.connectionTimeout || 60000);
	}

	public destroy():void
	{
		this.cancelDestroyTimeout();
		if (this.cancelBlockedCommand)
		{
			this.cancelBlockedCommand();
			this.cancelBlockedCommand = null;
		}
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

	private makeConnectionInfo():string
	{
		const config = this.config;
		const usepk = config.protocol === 'sftp' && !!config.privateKey;
		const datas = [
			config.protocol,
			config.username,
			config.password,
			config.host,
			config.port,
			config.remotePath,
			usepk,
			usepk ? config.privateKey : undefined,
			usepk ? config.passphrase : undefined
		];
		return JSON.stringify(datas);
	}

	private blockTestWith<T>(task:Promise<T>):Promise<T>
	{
		return new Promise<T>((resolve, reject)=>{
			if (this.cancelBlockedCommand) throw Error('Multiple order at same time');
			var blockTimeout = setTimeout(()=>reject('BLOCKED'), this.config.blockDetectingDuration || 8000);
			this.cancelBlockedCommand = ()=>{
				this.cancelBlockedCommand = null;
				clearTimeout(blockTimeout);
				reject('CANCELLED');
			};
			task.then(t=>{
				this.cancelBlockedCommand = null;
				clearTimeout(blockTimeout);
				resolve(t);
			}).catch(err=>{
				this.cancelBlockedCommand = null;
				clearTimeout(blockTimeout);
				reject(err);
			});
		});
	}
	
	private blockTestWrap<T>(task:work.Task, callback:(client:FileInterface)=>Promise<T>)
	{
		return this.init(task).then(async(client)=>{
			for (;;)
			{
				this.cancelDestroyTimeout();
				try
				{
					const t = await task.with(this.blockTestWith(callback(client)));
					this.updateDestroyTimeout();
					return t;
				}
				catch(err)
				{
					this.updateDestroyTimeout();
					if (err !== 'BLOCKED') throw err;
					this.destroy();
					client = await this.init(task);
				}
			}
		});
	}

	public async init(task:work.Task):Promise<FileInterface>
	{
		const that = this;
		const coninfo = this.makeConnectionInfo();
		if (this.client)
		{
			if (coninfo === this.connectionInfo)
			{
				this.updateDestroyTimeout();
				return Promise.resolve(this.client);
			}
			this.destroy();
			this.config.passwordInMemory = undefined;
		}
		this.connectionInfo = coninfo;
		
		const config = this.config;

		var url = '';
		url += config.protocol;
		url += '://';
		url += config.host;
		if (config.port)
		{
			url += ':';
			url += config.port;
		}
		url += '/';
		url += config.remotePath;
		url += '/';
	
		const usepk = config.protocol === 'sftp' && !!config.privateKey;
	
		async function tryToConnect(password:string|undefined):Promise<void>
		{
			for (;;)
			{
				const client = createClient(that.workspace, config);
				try
				{
					that.logger.message(`Try connect to ${url} with user ${config.username}`);
					await task.with(that.blockTestWith(client.connect(password)));
					client.log('Connected');
					that.client = client;
					return;
				}
				catch (err)
				{
					if (err !== 'BLOCKED') throw err;
					client.disconnect();
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
						that.destroy();
						throw err;
					}
					break;
				}
				that.logger.message(error);
				return error;
			}
		}
	
		_ok:if (!usepk && config.password === undefined)
		{
			var errorMessage:string|undefined;
			if (this.config.passwordInMemory !== undefined)
			{
				errorMessage = await tryToConnectOrErrorMessage(this.config.passwordInMemory);
				if (errorMessage === undefined) break _ok;
			}
			else for (;;)
			{
				const promptedPassword = await vscode.window.showInputBox({
					prompt:'ftp-kr: '+(config.protocol||'').toUpperCase()+" Password Request",
					password: true,
					ignoreFocusOut: true,
					placeHolder: errorMessage
				});
				if (promptedPassword === undefined)
				{
					this.destroy();
					throw 'PASSWORD_CANCEL';
				}
				errorMessage = await tryToConnectOrErrorMessage(promptedPassword);
				if (errorMessage === undefined)
				{
					if (config.keepPasswordInMemory !== false)
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
				this.destroy();
				throw err;
			}
		}
		
		if (!this.client) throw Error('Client is not created');
		this.client.oninvalidencoding = (errfiles:string[])=>{
			this.logger.errorConfirm("Invalid encoding detected. Please set fileNameEncoding correctly\n"+errfiles.join('\n'), 'Open config', 'Ignore after')
			.then((res)=>{
				switch(res)
				{
				case 'Open config': vsutil.open(this.workspace.query(cfg.Config).path); break; 
				case 'Ignore after': this.config.ignoreWrongFileEncoding = true; break;
				}
			});
		};
		this.updateDestroyTimeout();
		return this.client;
	}
	
	public rmdir(task:work.Task, workpath:string):Promise<void>
	{
		return this.blockTestWrap(task, client=>client.rmdir(workpath));
	}
	
	public remove(task:work.Task, workpath:string):Promise<void>
	{
		return this.blockTestWrap(task, client=>client.delete(workpath));
	}
	
	public mkdir(task:work.Task, workpath:string):Promise<void>
	{
		return this.blockTestWrap(task, client=>client.mkdir(workpath));
	}
	
	public upload(task:work.Task, workpath:string, localpath:File):Promise<void>
	{
		return this.blockTestWrap(task, client=>client.upload(workpath, localpath));
	}
	
	public download(task:work.Task, localpath:File, workpath:string):Promise<void>
	{
		return this.blockTestWrap(task, client=>client.download(localpath, workpath));
	}
	
	public list(task:work.Task, workpath:string):Promise<FileInfo[]>
	{
		return this.blockTestWrap(task, client=>client.list(workpath));
	}	
}
