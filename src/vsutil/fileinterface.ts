
import * as iconv from 'iconv-lite';
import {Options as FtpOptions} from 'ftp';
import {ConnectConfig as SftpOptions} from 'ssh2';

import File from '../util/file';

import * as log from './log';
import * as vsutil from './vsutil';
import * as ws from './ws';

import * as cfg from '../config';

export const NOT_CREATED = 'not created connection access';
export const DIRECTORY_NOT_FOUND = 1;
export const FILE_NOT_FOUND = 2;

export class FileInfo
{
	type:string = '';
	name:string = '';
	size:number = 0;
	date:number = 0;
}

export interface ServerConfig
{
	name?:string;
	remotePath?:string;
	protocol?:string;
	fileNameEncoding?:string;

	host?:string;
	username?:string;
	password?:string;
	keepPasswordInMemory?:boolean;
	port?:number;
	ignoreWrongFileEncoding?:boolean;
	createSyncCache?:boolean;
	
	passphrase?:string;
	connectionTimeout?:number;
	autoDownloadRefreshTime?:number;
	blockDetectingDuration?:number;
	refreshTime?:number;
	privateKey?:string;
	showGreeting?:boolean;
	
	ftpOverride?:FtpOptions;
	sftpOverride?:SftpOptions;
	
	passwordInMemory?:string;
}

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
				setTimeout(()=>this.oninvalidencoding(errfiles), 0);
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
