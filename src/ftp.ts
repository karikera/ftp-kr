
import FtpClientO = require('ftp');
import SftpClientO = require('ssh2-sftp-client');
import * as ssh2 from 'ssh2';
import * as iconv from 'iconv-lite';
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

class FtpClient extends FtpClientO
{
    // list(path: string, useCompression: boolean, callback: (error: Error, listing: Client.ListingElement[]) => void): void;
    // list(path: string, callback: (error: Error, listing: Client.ListingElement[]) => void): void;
    // list(useCompression: boolean, callback: (error: Error, listing: Client.ListingElement[]) => void): void;
    // list(callback: (error: Error, listing: Client.ListingElement[]) => void): void;

	public list(path:string|boolean|((error:Error|null, list?:FtpClientO.ListingElement[])=>void), zcomp?:boolean|((error:Error|null, list?:FtpClientO.ListingElement[])=>void), cb?:(error:Error|null, list?:FtpClientO.ListingElement[])=>void):void
	{
		var pathcmd:string;
		if (typeof path === 'string')
		{
			pathcmd = '-al ' + path;
			if (typeof zcomp === 'function')
			{
				cb = zcomp;
				zcomp = false;
			}
			else if (typeof zcomp === 'boolean')
			{
				if (!cb) throw Error('Invalid parameter');
			}
			else
			{
				if (!cb) throw Error('Invalid parameter');
				zcomp = false;
			}
		}
		else if (typeof path === 'boolean')
		{
			if (typeof zcomp !== 'function')
			{
				throw Error('Invalid parameter');
			}
			cb = zcomp;
			zcomp = path;
			pathcmd = '-al';
			path = '';
		}
		else
		{
			cb = path;
			zcomp = false;
			pathcmd = '-al';
			path = '';
		}
		if (path.indexOf(' ') === -1)
			return super.list(pathcmd, zcomp, cb);

		const path_ = path;
		const callback = cb;

		// store current path
		this.pwd((err, origpath) => {
			if (err) return callback(err);
			// change to destination path
			this.cwd(path_, err => {
				if (err) return callback(err);
				// get dir listing
				super.list('-al', false, (err, list) => {
					// change back to original path
					if (err) return this.cwd(origpath, () => callback(err));
					this.cwd(origpath, err => {
						if (err) return callback(err);
						callback(err, list);
					});
				});
			});
		});
	}
}

class SftpClient extends SftpClientO
{
	public mkdir(path:string, recursive?:boolean):Promise<void>
	{
		recursive = recursive || false;
	
		return new Promise((resolve, reject) => {
			const sftp = (<any>this).sftp;
	
			if (sftp) {
				if (!recursive) {
					sftp.mkdir(path, (err) => {
						if (err) {
							reject(err);
							return false;
						}
						resolve();
					});
					return false;
				}
	
				const tokens = path.split(/\//g);
				let p = '';
	
				const mkdir = () => {
					let token = tokens.shift();
	
					if (!token && !tokens.length) {
						resolve();
						return false;
					}
					p = p + token;
					sftp.mkdir(p, (err) => {
						if (err && err.code !== 3 && err.code !== 5) {
							reject(err);
						}
						p += '/';
						mkdir();
					});
				};
				return mkdir();
			} else {
				reject('sftp connect error');
			}
		});
	}
}

class FileInfo
{
	type:string = '';
	name:string = '';
	size:number = 0;
	date:number = 0;
}

export const DIRECTORY_NOT_FOUND = 1;
export const FILE_NOT_FOUND = 2;

const NOT_CREATED = 'not created connection access';

function _errorWrap(err):Error
{
	var nerr:Error;
	if (err.code)
	{
		nerr = new Error(err.message + "[" + err.code + "]");
	}
	else
	{
		nerr = new Error(err.message);
	}
	return nerr;
}

abstract class FileInterface
{
	protected readonly logger:log.Logger;
	protected readonly state:vsutil.StateBar;
	
	constructor(public readonly workspace:ws.Workspace, protected readonly config:cfg.ServerConfig)
	{
		this.logger = workspace.query(log.Logger);
		this.state = workspace.query(vsutil.StateBar);
	}

	abstract connect(password?:string):Promise<void>;
	abstract disconnect():void;
	abstract connected():boolean;

	private bin2str(bin:string):string
	{
		var buf = iconv.encode(bin, 'binary');
		return iconv.decode(buf, this.config.fileNameEncoding || 'utf-8');
	}
	private str2bin(str:string):string
	{
		var buf = iconv.encode(str, this.config.fileNameEncoding || 'utf-8');
		return iconv.decode(buf, 'binary');
	}
	private toftpPath(workpath:string):string
	{
		return this.str2bin(this.config.remotePath+'/'+workpath);
	}

	private logWithState(command:string):void
	{
		const message = this.config.name ? this.config.name+"> "+command : command;
		this.state.set(message);
		this.logger.message(message);
	}

	public log(command:string):void
	{
		const message = this.config.name ? this.config.name+"> "+command : command;
		this.logger.message(message);
	}

	_callWithName<T>(name:string, workpath:string, ignorecode:number, defVal:T, callback:(name:string)=>Promise<T>):Promise<T>
	{
		this.logWithState(name+' '+workpath);
		const ftppath = this.toftpPath(workpath);
		return callback(ftppath).then(v=>{
			this.state.close();
			return v;
		})
		.catch((err):T=>{
			this.state.close();
			if (err.ftpCode === ignorecode) return defVal;
			this.log(name+" fail: "+workpath);
			throw _errorWrap(err);
		});
	}

	upload(workpath:string, localpath:File):Promise<void>
	{
		this.logWithState('upload '+workpath);
		const ftppath = this.toftpPath(workpath);

		return this._put(localpath, ftppath)
		.catch(err=>{
			if (err.ftpCode !== DIRECTORY_NOT_FOUND) throw err;
			const ftpdir = ftppath.substr(0, ftppath.lastIndexOf("/") + 1);
			if (!ftpdir) throw err;
			return this._mkdir(ftpdir, true)
			.then(()=>this._put(localpath, ftppath));
		})
		.then(()=>{
			this.state.close();
		})
		.catch((err)=>{
			this.state.close();
			this.log("upload fail: "+workpath);
			throw _errorWrap(err);
		});
	}

	download(localpath:File, workpath:string):Promise<void>
	{
		this.logWithState('download '+workpath);
		const ftppath = this.toftpPath(workpath);

		return this._get(ftppath)
		.then((stream)=>{
			return new Promise<void>(resolve=>{
				stream.once('close', ()=>{
					this.state.close();
					resolve();
				});
				stream.pipe(localpath.createWriteStream());
			});
		})
		.catch(err=>{
			this.state.close();
			this.log("download fail: "+workpath);
			throw _errorWrap(err);
		});
	}

	list(workpath:string):Promise<FileInfo[]>
	{
		this.logWithState('list '+workpath);

		var ftppath = this.toftpPath(workpath);
		if (!ftppath) ftppath = ".";

		return this._list(ftppath).then((list)=>{
			this.state.close();

			const errfiles:string[] = [];
			for (var i = 0; i<list.length; i++)
			{
				const file = list[i];
				const fn = file.name = this.bin2str(file.name);
				if (!this.config.ignoreWrongFileEncoding)
				{
					if (fn.indexOf('�') !== -1 || fn.indexOf('?') !== -1)
						errfiles.push(fn);
				}
			}
			if (errfiles.length)
			{
				this.logger.errorConfirm("Invalid encoding detected. Please set fileNameEncoding correctly\n"+errfiles.join('\n'), 'Open config', 'Ignore after')
				.then((res)=>{
					switch(res)
					{
					case 'Open config': vsutil.open(this.workspace.query(cfg.Config).path); break; 
					case 'Ignore after': this.config.ignoreWrongFileEncoding = true; break;
					}
				});
			}
			return list;
		})
		.catch(err=>{
			this.state.close();
			this.log("list fail: "+workpath);
			throw _errorWrap(err);
		});
	}

	rmdir(workpath:string):Promise<void>
	{
		return this._callWithName("rmdir", workpath, FILE_NOT_FOUND, undefined, ftppath=>this._rmdir(ftppath, true));
	}

	delete(workpath:string):Promise<void>
	{
		return this._callWithName("delete", workpath, FILE_NOT_FOUND, undefined, ftppath=>this._delete(ftppath));
	}

	mkdir(workpath:string):Promise<void>
	{
		return this._callWithName("mkdir", workpath, 0, undefined, ftppath=>this._mkdir(ftppath, true));
	}

	lastmod(workpath:string):Promise<number>
	{
		return this._callWithName("lastmod", workpath, 0, 0, ftppath=>this._lastmod(ftppath));
	}

	abstract _mkdir(path:string, recursive:boolean):Promise<void>;
	abstract _rmdir(path:string, recursive:boolean):Promise<void>;
	abstract _delete(workpath:string):Promise<void>;
	abstract _put(localpath:File, ftppath:string):Promise<void>;
	abstract _get(ftppath:string):Promise<NodeJS.ReadableStream>;
	abstract _list(ftppath:string):Promise<Array<FileInfo>>;
	_lastmod(ftppath:string):Promise<number>
	{
		return Promise.reject('NOTSUPPORTED');
	}
}

class Ftp extends FileInterface
{
	client:FtpClient|null = null;

	connected():boolean
	{
		return this.client !== null;
	}

	connect(password?:string):Promise<void>
	{
		return new Promise<void>((resolve, reject)=>{
			if (this.client) return reject(Error('Already created'));
			this.client = new FtpClient;

			if (this.config.showGreeting)
			{
				this.client.on('greeting', msg=>this.log(msg));
			}
			this.client.on("ready", ()=>{
				if (!this.client) return reject(Error(NOT_CREATED));
				
				const socket:stream.Duplex = this.client['_socket'];
				const oldwrite = socket.write;
				socket.write = str=>oldwrite.call(socket, str, 'binary');
				socket.setEncoding('binary');
				resolve();
			});
			this.client.on("error", reject);

			var options:FtpClientO.Options;
			const config = this.config;
			if (config.protocol === 'ftps')
			{
				options = {
					secure: true,
					secureOptions:{
						rejectUnauthorized: false,
						//checkServerIdentity: (servername, cert)=>{}
					}
				};
			}
			else
			{
				options = {};
			}
	
			options.host = config.host;
			options.port = config.port ? config.port : 21;
			options.user = config.username;
			options.password = password;
			
			options = util.merge(options, config.ftpOverride);
			this.client.connect(options);
		});
	}

	disconnect()
	{
		if (this.client)
		{
			this.client.end();
			this.client = null;
		}
	}

	static wrapToPromise<T>(callback:(cb:(err:Error, val?:T)=>void)=>void):Promise<T>
	{
		return new Promise<T>((resolve, reject)=>callback((err, val)=>{
			if(err) reject(err);
			else resolve(val);
		}));
	}

	_rmdir(ftppath:string, recursive:boolean):Promise<void>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(NOT_CREATED));

		return Ftp.wrapToPromise<void>(callback=>client.rmdir(ftppath, recursive, callback))
		.catch(e=>{
			if (e.code === 550) e.ftpCode = FILE_NOT_FOUND;
			throw e;
		});
	}

	_mkdir(ftppath:string, recursive:boolean):Promise<void>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(NOT_CREATED));
		return Ftp.wrapToPromise<void>(callback=>client.mkdir(ftppath, recursive, callback));
	}

	_delete(ftppath:string):Promise<void>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(NOT_CREATED));
		return Ftp.wrapToPromise<void>(callback=>client.delete(ftppath, callback))
		.catch(e=>{
			if (e.code === 550) e.ftpCode = FILE_NOT_FOUND;
			throw e;
		});
	}

	_put(localpath:File, ftppath:string):Promise<void>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(NOT_CREATED));
		return Ftp.wrapToPromise<void>(callback=>client.put(localpath.fsPath, ftppath, callback))
		.catch(e=>{
			if (e.code === 553) e.ftpCode = DIRECTORY_NOT_FOUND;
			else if (e.code === 550) e.ftpCode = DIRECTORY_NOT_FOUND;
			throw e;
		});
	}

	_get(ftppath:string):Promise<NodeJS.ReadableStream>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(NOT_CREATED));
		return Ftp.wrapToPromise(callback=>client.get(ftppath, callback));
	}

	_list(ftppath:string):Promise<FileInfo[]>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(NOT_CREATED));
		return Ftp.wrapToPromise<FtpClientO.ListingElement[]>(callback=>client.list(ftppath, false, callback))
		.then(list=>list.map(from=>{
			const to = new FileInfo;
			to.type = from.type;
			to.name = from.name;
			to.date = +from.date;
			to.size = +from.size;
			return to;
		}))
		.catch(e=>{
			if (e.code === 550) return [];
			throw e;
		});
	}

	_lastmod(ftppath:string):Promise<number>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(NOT_CREATED));
		return Ftp.wrapToPromise(callback=>client.lastMod(ftppath, callback))
		.then(date=>+date);
	}

}

class Sftp extends FileInterface
{
	client:SftpClientO|null = null;

	connected():boolean
	{
		return this.client !== null;
	}

	async connect(password?:string):Promise<void>
	{
		try
		{
			if (this.client) throw Error(NOT_CREATED);
			this.client = new SftpClient;

			var options:ssh2.ConnectConfig = {};
			const config = this.config;
			if (config.privateKey)
			{
				var keyPath = config.privateKey;
				const keybuf = await this.workspace.child('.vscode',keyPath).open();
				options.privateKey = keybuf;
				options.passphrase = config.passphrase;
			}
			else
			{
				options.password = password;
			}

			options.host = config.host;
			options.port = config.port ? config.port : 22,
			options.username = config.username;
			// options.hostVerifier = (keyHash:string) => false;
			
			options = util.merge(options, config.sftpOverride);
			await this.client.connect(options);
		}
		catch(err)
		{
			throw err;
		}
	}
	
	disconnect():void
	{
		if (this.client)
		{
			this.client.end().catch(()=>{});
			this.client = null;
		}
	}

	_rmdir(ftppath:string):Promise<void>
	{
		if (!this.client) return Promise.reject(Error(NOT_CREATED));
		return this.client["rmdir"](ftppath, true)
		.catch(e=>{
			if (e.code === 2) e.ftpCode = FILE_NOT_FOUND;
			throw e;
		});
	}

	_delete(ftppath:string):Promise<void>
	{
		if (!this.client) return Promise.reject(Error(NOT_CREATED));
		return this.client.delete(ftppath)
		.catch(e=>{
			if (e.code === 2) e.ftpCode = FILE_NOT_FOUND;
			throw e;
		});
	}

	_mkdir(ftppath:string):Promise<void>
	{
		if (!this.client) return Promise.reject(Error(NOT_CREATED));
		return this.client.mkdir(ftppath, true);
	}

	_put(localpath:File, ftppath:string):Promise<void>
	{
		if (!this.client) return Promise.reject(Error(NOT_CREATED));
		return this.client.put(localpath.fsPath, ftppath, false, null)
		.catch(e=>{
			if (e.code === 2) e.ftpCode = DIRECTORY_NOT_FOUND;
			throw e;
		});
	}

	_get(ftppath:string):Promise<NodeJS.ReadableStream>
	{
		if (!this.client) return Promise.reject(Error(NOT_CREATED));
		return this.client.get(ftppath, false, null);
	}

	_list(ftppath:string):Promise<FileInfo[]>
	{
		if (!this.client) return Promise.reject(Error(NOT_CREATED));
		return this.client.list(ftppath)
		.then(list=>list.map(from=>{
			const to = new FileInfo;
			to.type = from.type;
			to.name = from.name;
			to.date = from.modifyTime;
			to.size = +from.size;
			return to;
		})).catch(e=>{
			if (e.code === 2) return [];
			else if(e.code === 550) return [];
			else throw e;
		});
	}

	lastmod(ftppath:string):Promise<number>
	{
		return Promise.reject('NOTSUPPORTED');
	}
}

export class FtpManager
{
	client:FileInterface|null = null;

	private connectionInfo:string = '';
	private destroyTimeout:NodeJS.Timer|null = null;
	private cancelBlockedCommand:(()=>void)|null = null;
	private connected:boolean = false;
	
	private readonly logger:log.Logger;

	constructor(public readonly workspace:ws.Workspace, public readonly config:cfg.ServerConfig)
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
			var blockTimeout = setTimeout(()=>reject('BLOCKED'), this.config.blockDetectingDuration || 5000);
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
	
	private task<T>(task:work.Task, callback:(client:FileInterface)=>Promise<T>)
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

		function createClient():FileInterface
		{
			var newclient:FileInterface;
			switch (config.protocol)
			{
			case 'sftp': newclient = new Sftp(that.workspace, that.config); break;
			case 'ftp': newclient = new Ftp(that.workspace, that.config); break;
			case 'ftps': newclient = new Ftp(that.workspace, that.config); break;
			default: throw Error(`Invalid protocol ${config.protocol}`);
			}
			return newclient;
		}
	
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
				const client = createClient();
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
						throw _errorWrap(err);
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
				throw _errorWrap(err);
			}
		}
			
		if (!this.client) throw Error('Client is not created');
		this.updateDestroyTimeout();
		return this.client;
	}
	
	public rmdir(task:work.Task, workpath:string):Promise<void>
	{
		return this.task(task, client=>client.rmdir(workpath));
	}
	
	public remove(task:work.Task, workpath:string):Promise<void>
	{
		return this.task(task, client=>client.delete(workpath));
	}
	
	public mkdir(task:work.Task, workpath:string):Promise<void>
	{
		return this.task(task, client=>client.mkdir(workpath));
	}
	
	public upload(task:work.Task, workpath:string, localpath:File):Promise<void>
	{
		return this.task(task, client=>client.upload(workpath, localpath));
	}
	
	public download(task:work.Task, localpath:File, workpath:string):Promise<void>
	{
		return this.task(task, client=>client.download(localpath, workpath));
	}
	
	public list(task:work.Task, workpath:string):Promise<FileInfo[]>
	{
		return this.task(task, client=>client.list(workpath));
	}	
}
