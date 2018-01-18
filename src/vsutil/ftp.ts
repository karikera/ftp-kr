
import FtpClientO = require('ftp');
import * as stream from 'stream';

import File from '../util/file';
import * as util from '../util/util';

import { FileInterface, NOT_CREATED, FILE_NOT_FOUND, DIRECTORY_NOT_FOUND, FileInfo } from "./fileinterface";



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

export class FtpConnection extends FileInterface
{
	client:FtpClient|null = null;

	connected():boolean
	{
		return this.client !== null;
	}

	async _connect(password?:string):Promise<void>
	{
		try
		{
			if (this.client) throw Error('Already created');
			const client = this.client = new FtpClient;
			if (this.config.showGreeting)
			{
				client.on('greeting', msg=>this.log(msg));
			}

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
			
			return await new Promise<void>((resolve, reject)=>{
				client.on("ready", ()=>{
					if (!client) return reject(Error(NOT_CREATED));
					
					const socket:stream.Duplex = client['_socket'];
					const oldwrite = socket.write;
					socket.write = str=>oldwrite.call(socket, str, 'binary');
					socket.setEncoding('binary');
					resolve();
				})
				.on("error", reject)
				.connect(options);
			});
		}
		catch (err)
		{
			if (this.client)
			{
				this.client.end();
				this.client = null;
			}
			throw err;
		}
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

		return FtpConnection.wrapToPromise<void>(callback=>client.rmdir(ftppath, recursive, callback))
		.catch(e=>{
			if (e.code === 550) e.ftpCode = FILE_NOT_FOUND;
			throw e;
		});
	}

	_mkdir(ftppath:string, recursive:boolean):Promise<void>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(NOT_CREATED));
		return FtpConnection.wrapToPromise<void>(callback=>client.mkdir(ftppath, recursive, callback));
	}

	_delete(ftppath:string):Promise<void>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(NOT_CREATED));
		return FtpConnection.wrapToPromise<void>(callback=>client.delete(ftppath, callback))
		.catch(e=>{
			if (e.code === 550) e.ftpCode = FILE_NOT_FOUND;
			throw e;
		});
	}

	_put(localpath:File, ftppath:string):Promise<void>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(NOT_CREATED));
		return FtpConnection.wrapToPromise<void>(callback=>client.put(localpath.fsPath, ftppath, callback))
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
		return FtpConnection.wrapToPromise(callback=>client.get(ftppath, callback));
	}

	_list(ftppath:string):Promise<FileInfo[]>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(NOT_CREATED));
		return FtpConnection.wrapToPromise<FtpClientO.ListingElement[]>(callback=>client.list(ftppath, false, callback))
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
		return FtpConnection.wrapToPromise(callback=>client.lastMod(ftppath, callback))
		.then(date=>+date);
	}

}
