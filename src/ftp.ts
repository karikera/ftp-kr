
import FtpClient = require('ftp');
import SftpClient = require('ssh2-sftp-client');
import * as ssh2 from 'ssh2';
import * as cfg from './config';
import * as util from './util';
import * as ofs from 'fs';
import * as fs from './fs';
import * as iconv from 'iconv-lite';
import * as path from 'path';
import * as vscode from 'vscode';
import * as work from './work';

const config = cfg.config;

export const DIRECTORY_NOT_FOUND = 1;
export const FILE_NOT_FOUND = 2;

const ALREADY_DESTROYED = 'destroyed connection access';

var client:FileInterface|null = null;

var connectionInfo:string = '';

var passwordInMemory:string|undefined = undefined;

function makeConnectionInfo():string
{
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

function bin2str(bin:string):string
{
    var buf = iconv.encode(bin, 'binary');
    return iconv.decode(buf, config.fileNameEncoding);
}
function str2bin(str:string):string
{
    var buf = iconv.encode(str, config.fileNameEncoding);
    return iconv.decode(buf, 'binary');
}
function toftpPath(workpath:string):string
{
    return str2bin(config.remotePath+workpath);
}

class FileInfo
{
	type:string = '';
	name:string = '';
	size:number = 0;
	date:number = 0;

	constructor()
	{
	}
}

abstract class FileInterface
{
	destroyTimeout:NodeJS.Timer|null = null;
	
	constructor()
	{
		client = this;
	}

	abstract connect(password?:string):Promise<void>;

	abstract destroyed():boolean;

	cancelDestroyTimeout():void
	{
		if (!this.destroyTimeout)
			return;

		clearTimeout(this.destroyTimeout);
		this.destroyTimeout = null;
	}

	update():void
	{
		this.cancelDestroyTimeout();
		this.destroyTimeout = setTimeout(()=>{
			util.message('Disconnected');
			this.destroy();
		}, config.connectionTimeout ? config.connectionTimeout : 60000);
	}

	destroy():void
	{
		this.cancelDestroyTimeout();
		client = null;
	}

	_callWithName<T>(name:string, workpath:string, ignorecode:number, defVal:T, callback:(name:string)=>Promise<T>):Promise<T>
	{
		this.cancelDestroyTimeout();
		util.setState(name +" "+workpath);
		util.message(name +": "+workpath);
		const ftppath = toftpPath(workpath);
		return callback(ftppath).then(v=>{
			util.setState("");
			this.update();
			return v;
		})
		.catch((err):T=>{
			util.setState("");
			this.update();
			if (err.ftpCode === ignorecode) return defVal;
			util.message(name+" fail: "+workpath);
			throw _errorWrap(err);
		});
	}

	upload(workpath:string, localpath:string):Promise<void>
	{
		this.cancelDestroyTimeout();
		util.setState("upload "+workpath);
		util.message("upload: "+workpath);
		const ftppath = toftpPath(workpath);

		return this._put(localpath, ftppath)
		.catch(err=>{
			if (err.ftpCode !== DIRECTORY_NOT_FOUND) throw err;
			const ftpdir = ftppath.substr(0, ftppath.lastIndexOf("/") + 1);
			if (!ftpdir) throw err;
			return this._mkdir(ftpdir, true)
			.then(()=>this._put(localpath, ftppath));
		})
		.then(()=>{
			util.setState("");
			this.update();
		})
		.catch((err)=>{
			util.setState("");
			this.update();
			util.message("upload fail: "+workpath);
			throw _errorWrap(err);
		});
	}

	download(localpath:string, workpath:string):Promise<void>
	{
		this.cancelDestroyTimeout();
		util.setState("download "+workpath);
		util.message("download: "+workpath);
		const ftppath = toftpPath(workpath);

		return this._get(ftppath)
		.then((stream)=>{
			return new Promise<void>(resolve=>{
				stream.once('close', ()=>{
					util.setState("");
					this.update();
					resolve();
				});
				stream.pipe(ofs.createWriteStream(localpath));
			});
		})
		.catch(err=>{
			util.setState("");
			this.update();
			util.message("download fail: "+workpath);
			throw _errorWrap(err);
		});
	}

	list(workpath:string):Promise<FileInfo[]>
	{
		this.cancelDestroyTimeout();
		util.setState("list "+workpath);
		util.message("list: "+workpath);

		var ftppath = toftpPath(workpath);
		if (!ftppath) ftppath = ".";

		return this._list(ftppath).then((list)=>{
			util.setState("");
			this.update();

			const errfiles:string[] = [];
			for (var i = 0; i<list.length; i++)
			{
				const file = list[i];
				const fn = file.name = bin2str(file.name);
				if (!config.ignoreWrongFileEncoding)
				{
					if (fn.indexOf('�') !== -1 || fn.indexOf('?') !== -1)
						errfiles.push(fn);
				}
			}
			if (errfiles.length)
			{
				util.errorConfirm("Invalid encoding detected. Please set fileNameEncoding correctly\n"+errfiles.join('\n'), 'Open config', 'Ignore after')
				.then((res)=>{
					switch(res)
					{
					case 'Open config': util.open(cfg.PATH); break; 
					case 'Ignore after': config.ignoreWrongFileEncoding = true; break;
					}
				});
			}
			return list;
		})
		.catch(err=>{
			util.setState("");
			this.update();
			util.message("list fail: "+workpath);
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
	abstract _put(localpath:string, ftppath:string):Promise<void>;
	abstract _get(ftppath:string):Promise<NodeJS.ReadableStream>;
	abstract _list(ftppath:string):Promise<Array<FileInfo>>;
	_lastmod(ftppath:string):Promise<number>
	{
		return Promise.reject('NOTSUPPORTED');
	}
}

class Ftp extends FileInterface
{
	client:FtpClient|null = new FtpClient();

	constructor()
	{
		super();
	}

	destroyed():boolean
	{
		return client === null;
	}

	connect(password?:string):Promise<void>
	{
		client = this;

		return new Promise<void>((resolve, reject)=>{
			if (!this.client) return Promise.reject(Error(ALREADY_DESTROYED));

			this.client.on("ready", ()=>{
				if (!this.client) return Promise.reject(Error(ALREADY_DESTROYED));
				const socket = this.client['_socket'];
				const oldwrite = socket.write;
				socket.write = str=>{
					return oldwrite.call(socket, str, 'binary');
				};
				this.update();
				resolve();
			});
			this.client.on("error", reject);

			var options:FtpClient.Options;
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

	destroy()
	{
		super.destroy();
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
		if (!client) return Promise.reject(Error(ALREADY_DESTROYED));

		return Ftp.wrapToPromise<void>(callback=>client.rmdir(ftppath, recursive, callback))
		.catch(e=>{
			if (e.code === 550) e.ftpCode = FILE_NOT_FOUND;
			throw e;
		});
	}

	_mkdir(ftppath:string, recursive:boolean):Promise<void>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(ALREADY_DESTROYED));
		return Ftp.wrapToPromise<void>(callback=>client.mkdir(ftppath, recursive, callback));
	}

	_delete(ftppath:string):Promise<void>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(ALREADY_DESTROYED));
		return Ftp.wrapToPromise<void>(callback=>client.delete(ftppath, callback))
		.catch(e=>{
			if (e.code === 550) e.ftpCode = FILE_NOT_FOUND;
			throw e;
		});
	}

	_put(localpath:string, ftppath:string):Promise<void>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(ALREADY_DESTROYED));
		return Ftp.wrapToPromise<void>(callback=>client.put(localpath, ftppath, callback))
		.catch(e=>{
			if (e.code === 553) e.ftpCode = DIRECTORY_NOT_FOUND;
			throw e;
		});
	}

	_get(ftppath:string):Promise<NodeJS.ReadableStream>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(ALREADY_DESTROYED));
		return Ftp.wrapToPromise(callback=>client.get(ftppath, callback));
	}

	_list(ftppath:string):Promise<FileInfo[]>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(ALREADY_DESTROYED));
		return Ftp.wrapToPromise<FtpClient.ListingElement[]>(callback=>client.list('-al '+ftppath, false, callback))
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
		if (!client) return Promise.reject(Error(ALREADY_DESTROYED));
		return Ftp.wrapToPromise(callback=>client.lastMod(ftppath, callback))
		.then(date=>+date);
	}

}

class Sftp extends FileInterface
{
	client:SftpClient.Client|null = new SftpClient;

	constructor()
	{
		super();
	}
	
	destroyed():boolean
	{
		return client === null;
	}

	async connect(password?:string):Promise<void>
	{
		try
		{
			if (!this.client) throw Error(ALREADY_DESTROYED);

			var options:ssh2.ConnectConfig;
			if (config.privateKey)
			{
				var keyPath = config.privateKey;
				const keybuf = await new Promise<Buffer>((resolve, reject)=>{
					if (!path.isAbsolute(keyPath))
					{
						keyPath = path.join(fs.workspace, '.vscode', keyPath);
					}
					ofs.readFile(keyPath, 'utf-8', (err, data:Buffer)=>{
						if (err) reject(err);
						else resolve(data);
					});
				});
				options = {
					privateKey: keybuf,
					passphrase: config.passphrase
				}
			}
			else
			{
				options = {
					password,
				};
			}

			options.host = config.host;
			options.port = config.port ? config.port : 22,
			options.username = config.username;
			// options.hostVerifier = (keyHash:string) => false;
			
			options = util.merge(options, config.sftpOverride);
			await this.client.connect(options);
			this.update();
		}
		catch(err)
		{
			throw err;
		}
	}
	
	destroy():void
	{
		super.destroy();
		if (this.client)
		{
			this.client.end().catch(()=>{});
			this.client = null;
		}
	}

	_rmdir(ftppath:string):Promise<void>
	{
		if (!this.client) return Promise.reject(Error(ALREADY_DESTROYED));
		return this.client["rmdir"](ftppath, true)
		.catch(e=>{
			if (e.code === 2) e.ftpCode = FILE_NOT_FOUND;
			throw e;
		});
	}

	_delete(ftppath:string):Promise<void>
	{
		if (!this.client) return Promise.reject(Error(ALREADY_DESTROYED));
		return this.client.delete(ftppath)
		.catch(e=>{
			if (e.code === 2) e.ftpCode = FILE_NOT_FOUND;
			throw e;
		});
	}

	_mkdir(ftppath:string):Promise<void>
	{
		if (!this.client) return Promise.reject(Error(ALREADY_DESTROYED));
		return this.client.mkdir(ftppath, true);
	}

	_put(localpath:string, ftppath:string):Promise<void>
	{
		if (!this.client) return Promise.reject(Error(ALREADY_DESTROYED));
		return this.client.put(localpath, ftppath, false, null)
		.catch(e=>{
			if (e.code === 2) e.ftpCode = DIRECTORY_NOT_FOUND;
			throw e;
		});
	}

	_get(ftppath:string):Promise<NodeJS.ReadableStream>
	{
		if (!this.client) return Promise.reject(Error(ALREADY_DESTROYED));
		return this.client.get(ftppath, false, null);
	}

	_list(ftppath:string):Promise<FileInfo[]>
	{
		if (!this.client) return Promise.reject(Error(ALREADY_DESTROYED));
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

function _errorWrap(err):Error
{
	if (err.code)
	{
		return new Error(err.message + "[" + err.code + "]");
	}
	else
	{
		return new Error(err.message);
	}
}

export async function init(task:work.Task):Promise<FileInterface>
{
	const coninfo = makeConnectionInfo();
    if (client)
	{
		if (coninfo === connectionInfo)
		{
			client.update();
			return Promise.resolve(client);
		}
		util.message('Disconnected');
		client.destroy();
		passwordInMemory = undefined;
    }
	connectionInfo = coninfo;
	
	var newclient:FileInterface;
	switch (config.protocol)
	{
	case 'sftp': newclient = new Sftp; break;
	case 'ftp': newclient = new Ftp; break;
	case 'ftps': newclient = new Ftp; break;
	default: throw Error(`Invalid protocol ${config.protocol}`);
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
	url += config.remotePath;
	url += '/';

	const usepk = config.protocol === 'sftp' && !!config.privateKey;

	async function tryToConnect(password:string|undefined):Promise<void>
	{
		util.message(`Try connect to ${url} with user ${config.username}`);
		await task.with(newclient.connect(password));
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
			switch (err.message)
			{
			case 'All configured authentication methods failed':
				error = 'Authentication failed';
				break;
			default:
				newclient.destroy();
				throw _errorWrap(err);
			}
			util.message(error);
			return error;
		}
	}

	_ok:if (!usepk && config.password === undefined)
	{
		var errorMessage:string|undefined;
		if (passwordInMemory !== undefined)
		{
			errorMessage = await tryToConnectOrErrorMessage(passwordInMemory);
			if (errorMessage === undefined) break _ok;
		}
		else for (;;)
		{
			const promptedPassword = await vscode.window.showInputBox({
				prompt:'ftp-kr: '+config.protocol.toUpperCase()+" Password Request",
				password: true,
				ignoreFocusOut: true,
				placeHolder: errorMessage
			});
			if (promptedPassword === undefined)
			{
				newclient.destroy();
				throw 'PASSWORD_CANCEL';
			}
			errorMessage = await tryToConnectOrErrorMessage(promptedPassword);
			if (errorMessage === undefined)
			{
				if (config.keepPasswordInMemory !== false)
				{
					passwordInMemory = promptedPassword;
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
			newclient.destroy();
			throw _errorWrap(err);
		}
	}
		
	util.message('Connected');
	return newclient;
}

export function rmdir(task:work.Task, workpath:string):Promise<void>
{
	return init(task).then(client => task.with(client.rmdir(workpath)));
}

export function remove(task:work.Task, workpath:string):Promise<void>
{
	return init(task).then(client => task.with(client.delete(workpath)));
}

export function mkdir(task:work.Task, workpath:string):Promise<void>
{
	return init(task).then(client => task.with(client.mkdir(workpath)));
}

export function upload(task:work.Task, workpath:string, localpath:string):Promise<void>
{
	return init(task).then(client => task.with(client.upload(workpath, localpath)));
}

export function download(task:work.Task, localpath:string, workpath:string):Promise<void>
{
	return init(task).then(client => task.with(client.download(localpath, workpath)));
}

export function list(task:work.Task, workpath:string):Promise<FileInfo[]>
{
	return init(task).then(client => task.with(client.list(workpath)));
}

export function cleanPasswordInMemory():void
{
	passwordInMemory = undefined;
}
