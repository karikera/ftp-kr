
import * as iconv from 'iconv-lite';

import {File} from '../util/file';

import * as log from './log';
import * as vsutil from './vsutil';
import * as ws from './ws';

import * as cfg from '../config';
import { ServerConfig, FileInfo } from '../util/fileinfo';
import { ftp_path } from '../util/ftp_path';

export const NOT_CREATED = 'not created connection access';
export const DIRECTORY_NOT_FOUND = 1;
export const FILE_NOT_FOUND = 2;

declare global
{
	interface Error
	{
		ftpCode?:number;
	}
}

function _errorWrap(err):Error
{
	if (err.code)
	{
		err.message = err.message + "[" + err.code + "]";
	}
	const nstack = Error(err.message).stack || '';
	nstack.substr(nstack.indexOf('\n'));
	err.stack = nstack;
	return err;
}

export abstract class FileInterface
{
	protected readonly logger:log.Logger;
	protected readonly state:vsutil.StateBar;
	public oninvalidencoding:(errfiles:string[])=>void = ()=>{};
	
	constructor(public readonly workspace:ws.Workspace, protected readonly config:ServerConfig)
	{
		this.logger = workspace.query(log.Logger);
		this.state = workspace.query(vsutil.StateBar);
	}

	public connect(password?:string):Promise<void>
	{
		return this._connect(password).catch(err=>{throw _errorWrap(err);});
	}

	abstract _connect(password?:string):Promise<void>;
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

	_callWithName<T>(name:string, ftppath:string, ignorecode:number, defVal:T, callback:(name:string)=>Promise<T>):Promise<T>
	{
		this.logWithState(name+' '+ftppath);
		return callback(this.str2bin(ftppath)).then(v=>{
			this.state.close();
			return v;
		})
		.catch((err):T=>{
			this.state.close();
			if (err.ftpCode === ignorecode) return defVal;
			this.log(name+" fail: "+ftppath);
			throw _errorWrap(err);
		});
	}

	upload(ftppath:string, localpath:File):Promise<void>
	{
		this.logWithState('upload '+ftppath);
		const binpath = this.str2bin(ftppath);

		return this._put(localpath, binpath)
		.catch(err=>{
			if (err.ftpCode !== DIRECTORY_NOT_FOUND) throw err;
			const idx = ftppath.lastIndexOf("/");
			if (idx <= 0) throw err;
			return this._mkdir(ftppath.substr(0, idx), true)
			.then(()=>this._put(localpath, binpath));
		})
		.then(()=>{
			this.state.close();
		})
		.catch((err)=>{
			this.state.close();
			this.log("upload fail: "+ftppath);
			throw _errorWrap(err);
		});
	}

	download(localpath:File, ftppath:string):Promise<void>
	{
		this.logWithState('download '+ftppath);

		return this._get(this.str2bin(ftppath))
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
			this.log("download fail: "+ftppath);
			throw _errorWrap(err);
		});
	}

	list(ftppath:string):Promise<FileInfo[]>
	{
		if (!ftppath) ftppath = ".";
		this.logWithState('list '+ftppath);

		return this._list(this.str2bin(ftppath)).then((list)=>{
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
				setTimeout(()=>this.oninvalidencoding(errfiles), 0);
			}
			return list;
		})
		.catch(err=>{
			this.state.close();
			this.log("list fail: "+ftppath);
			throw _errorWrap(err);
		});
	}

	rmdir(ftppath:string):Promise<void>
	{
		return this._callWithName("rmdir", ftppath, FILE_NOT_FOUND, undefined, binpath=>this._rmdir(binpath, true));
	}

	delete(ftppath:string):Promise<void>
	{
		return this._callWithName("delete", ftppath, FILE_NOT_FOUND, undefined, binpath=>this._delete(binpath));
	}

	mkdir(ftppath:string):Promise<void>
	{
		return this._callWithName("mkdir", ftppath, 0, undefined, binpath=>this._mkdir(binpath, true));
	}

	readlink(fileinfo:FileInfo):Promise<string>
	{
		if (fileinfo.type !== 'l') throw Error(fileinfo.ftppath + ' is not symlink');
		this.logWithState('readlink '+fileinfo.name);
		return this._readlink(fileinfo, this.str2bin(fileinfo.ftppath)).then(v=>{
			if (v.startsWith('/')) v = ftp_path.normalize(v);
			else v = ftp_path.normalize(fileinfo.ftppath + '/../' + v);
			fileinfo.link = v;
			this.state.close();
			return v;
		}).catch((err)=>{
			this.state.close();
			this.log("readlink fail: "+fileinfo.name);
			throw _errorWrap(err);
		});
	}


	abstract _mkdir(path:string, recursive:boolean):Promise<void>;
	abstract _rmdir(path:string, recursive:boolean):Promise<void>;
	abstract _delete(ftppath:string):Promise<void>;
	abstract _put(localpath:File, ftppath:string):Promise<void>;
	abstract _get(ftppath:string):Promise<NodeJS.ReadableStream>;
	abstract _list(ftppath:string):Promise<Array<FileInfo>>;
	abstract _readlink(fileinfo:FileInfo, ftppath:string):Promise<string>;
}
