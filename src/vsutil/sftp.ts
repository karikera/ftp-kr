
import { Client, ConnectConfig, SFTPWrapper } from 'ssh2';
import { File } from 'krfile';

import { FileInfo } from '../util/fileinfo';
import { merge, errorWrap } from '../util/util';
import { ServerConfig } from '../util/serverinfo';

import { FileInterface, NOT_CREATED, DIRECTORY_NOT_FOUND, FILE_NOT_FOUND } from './fileinterface';
import { Workspace } from './ws';


export class SftpConnection extends FileInterface
{
	private client:Client|null = null;
	private sftp:SFTPWrapper|null = null;

	constructor(workspace:Workspace, config:ServerConfig)
	{
		super(workspace, config);
	}
	
	connected():boolean
	{
		return this.client !== null;
	}

	async _connect(password?:string):Promise<void>
	{
		try
		{
			if (this.client) throw Error('Already created');
			const client = this.client = new Client;
			if (this.config.showGreeting)
			{
				client.on('banner', (msg:string)=>this.log(msg));
			}

			var options:ConnectConfig = {};
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
			
			options = merge(options, config.sftpOverride);
	
			return await new Promise<void>((resolve, reject) => {
				client.on('ready', () => {
					if (!client) return reject(Error(NOT_CREATED));

					client.sftp((err, sftp) => {
						if (err) return reject(err);
						this.sftp = sftp;
						resolve();
					});
				})
				.on('error', reject)
				.connect(options);
			});
		}
		catch(err)
		{
			if (this.sftp)
			{
				this.sftp.end();
				this.sftp = null;
			}
			if (this.client)
			{
				this.client.destroy();
				this.client = null;
			}
			throw err;
		}
	}
	
	disconnect():void
	{
		if (this.sftp)
		{
			this.sftp.end();
			this.sftp = null;
		}
		if (this.client)
		{
			this.client.end();
			this.client = null;
		}
	}

	terminate():void
	{
		if (this.sftp)
		{
			this.sftp.end();
			this.sftp = null;
		}
		if (this.client)
		{
			this.client.destroy();
			this.client = null;
		}
	}

	exec(command:string):Promise<string>
	{
		const client = this.client;
		if (!client) return Promise.reject(Error(NOT_CREATED));

		return new Promise((resolve, reject)=>{
			client.exec(command, (err, stream)=>{
				if (err) return reject(errorWrap(err));
				var data = '';
				var errs = '';
				stream.on('data', (stdout:string|undefined, stderr:string|undefined)=>{
					if (stdout) data += stdout;
					if (stderr) errs += stderr;
				})
				.on('error', (err:any)=>reject(errorWrap(err)))
				.on('exit', (code, signal)=>{
					if (errs) reject(Error(errs));
					else resolve(data.trim());
					stream.end();
				});
			});
		});
	}

	pwd():Promise<string>
	{
		return this.exec('pwd');
	}

	private _readLink(ftppath:string):Promise<string>
	{
		return new Promise<string>((resolve, reject)=>{
			const sftp = this.sftp;
			if (!sftp) return reject(Error(NOT_CREATED));

			sftp.readlink(ftppath, (err, target)=>{
				if (err) return reject(err);
				resolve(target);
			});
		})
	}

	private _rmdirSingle(ftppath:string):Promise<void>
	{
		return new Promise((resolve, reject) => {
			const sftp = this.sftp;
			if (!sftp) return reject(Error(NOT_CREATED));
			return sftp.rmdir(ftppath, (err) => {
				if (err)
				{
					if (err.code === 2) err.ftpCode = FILE_NOT_FOUND;
					reject(err);
				}
				else
				{
					resolve();
				}
			});
		});
	}

	async _rmdir(ftppath:string):Promise<void>
	{
		const sftp = this.sftp;
		if (!sftp) throw Error(NOT_CREATED);

		const list = await this.list(ftppath);
		if (list.length === 0)
		{
			return await this._rmdirSingle(ftppath);
		}

		const parentPath = ftppath.endsWith('/') ? ftppath : ftppath + '/';
		
		for (const item of list)
		{
			const name = item.name;
			const subPath:string = name[0] === '/' ? name : parentPath + name;

			if (item.type === 'd')
			{
				if (name !== '.' && name !== '..')
				{
					await this.rmdir(subPath);
				}
			}
			else
			{
				await this.delete(subPath);
			}
		}
		return this.rmdir(ftppath);
	}

	_delete(ftppath:string):Promise<void>
	{
		return new Promise((resolve, reject) => {	
			const sftp = this.sftp;
			if (!sftp) return reject(Error(NOT_CREATED));
			sftp.unlink(ftppath, (err) => {
				if (err) {
					if (err.code === 2) err.ftpCode = FILE_NOT_FOUND;
					reject(err);
					return false;
				}
				resolve();
			});
		});	
	}

	_mkdirSingle(ftppath:string):Promise<void>
	{
		return new Promise((resolve, reject) => {	
			const sftp = this.sftp;
			if (!sftp) return reject(Error(NOT_CREATED));
			sftp.mkdir(ftppath, (err) => {
				if (err)
				{
					if (err.code !== 3 && err.code !== 4 && err.code !== 5)
					{
						return reject(err);
					}
				}
				resolve();
			});
		});
	}

	async _mkdir(ftppath:string):Promise<void>
	{
		var idx = 0;
		for (;;)
		{
			const find = ftppath.indexOf('/', idx);
			if (find === -1) break;
			idx = find+1;
			const parentpath = ftppath.substr(0, find);
			if (!parentpath) continue;
			await this._mkdirSingle(parentpath);
		}
		await this._mkdirSingle(ftppath);
	}

	_put(localpath:File, ftppath:string):Promise<void>
	{
		return new Promise((resolve, reject) => {
			const sftp = this.sftp;
			if (!sftp) return reject(Error(NOT_CREATED));
			sftp.fastPut(localpath.fsPath, ftppath, (err) => {
				if (err)
				{
					if (err.code === 2) err.ftpCode = DIRECTORY_NOT_FOUND;
					reject(err);
					return;
				}
				resolve();
			});
		});
	}

	_get(ftppath:string):Promise<NodeJS.ReadableStream>
	{
		return new Promise((resolve, reject) => {
			const sftp = this.sftp;
			if (!sftp) return reject(Error(NOT_CREATED));
			try
			{
				const stream = sftp.createReadStream(ftppath, {encoding:<any>null});
				stream.on('error', reject)
				.on('readable', () => resolve(stream));
			}
			catch(err)
			{
				if (err.code === 2) err.ftpCode = FILE_NOT_FOUND;
				else if(err.code === 550) err.ftpCode = FILE_NOT_FOUND;
				reject(err);
			}
		});	
	}

	_list(ftppath:string):Promise<FileInfo[]>
	{
		return new Promise((resolve, reject) => {
			const sftp = this.sftp;
			if (!sftp) return reject(Error(NOT_CREATED));
			sftp.readdir(ftppath, (err, list) => {
				if (err) {
					if (err.code === 2) return resolve([]);
					else if(err.code === 550) return resolve([]);
					else reject(err);
					return false;
				}

				if (!ftppath.endsWith('/')) ftppath += '/';

				// reset file info
				const nlist:FileInfo[] = new Array(list.length);
				for (var i=0;i<list.length;i++)
				{
					const item = list[i];
					const to = new FileInfo;
					to.type = <any>item.longname.substr(0, 1);
					to.name = item.filename;
					to.date = item.attrs.mtime * 1000;
					to.size = +item.attrs.size;
					// const reg = /-/gi;
					// accessTime: item.attrs.atime * 1000,
					// rights: {
					// 	user: item.longname.substr(1, 3).replace(reg, ''),
					// 	group: item.longname.substr(4,3).replace(reg, ''),
					// 	other: item.longname.substr(7, 3).replace(reg, '')
					// },
					// owner: item.attrs.uid,
					// group: item.attrs.gid
					nlist[i] = to;
				}
				resolve(nlist);
			});
		});
	}

	_readlink(fileinfo:FileInfo, ftppath:string):Promise<string>
	{
		return new Promise<string>((resolve, reject)=>{
			if (fileinfo.link)
			{
				resolve(fileinfo.link);
				return;
			}
			const sftp = this.sftp;
			if (!sftp) return reject(Error(NOT_CREATED));
			sftp.readlink(ftppath, (err, target)=>{
				if (err) return reject(err);
				fileinfo.link = target;
				resolve(target);
			});
		});
	}
}
