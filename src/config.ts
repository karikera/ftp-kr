
import * as fs from "./util/fs";
import * as work from "./util/work";
import * as log from "./util/log";
import * as util from "./util/util";
import * as vsutil from "./util/vsutil";
import * as event from "./util/event";

import {Options as FtpOptions} from 'ftp';
import {ConnectConfig as SftpOptions} from 'ssh2';
import minimatch = require('minimatch');

var initTimeForVSBug:number = 0;

const CONFIG_BASE:ConfigOptions = {
	host: "",
	username: "",
	remotePath: "",
	protocol: "ftp",
	port: 0,
	fileNameEncoding: "utf8", 
	ignoreWrongFileEncoding: false,
	createSyncCache: true, 
	autoUpload: true,
	autoDelete: false,
	autoDownload: false,
	disableFtp: false,
	ignore:[
		".git",
		"/.vscode/chrome",
		"/.vscode/.key",
		"/.vscode/ftp-kr.task.json",
		"/.vscode/ftp-kr.error.log",
		"/.vscode/ftp-kr.sync.*.json"
	],
};
const CONFIG_INIT:ConfigOptions = {
	host: "",
	username: "",
	password: "",
	remotePath: "",
	protocol: "ftp",
	port: 0,
	fileNameEncoding: "utf8", 
	ignoreWrongFileEncoding: false,
	createSyncCache: true, 
	autoUpload: true,
	autoDelete: false,
	autoDownload: false,
	disableFtp: false,
	ignore:[
		".git",
		"/.vscode/chrome",
		"/.vscode/.key",
		"/.vscode/ftp-kr.task.json",
		"/.vscode/ftp-kr.error.log",
		"/.vscode/ftp-kr.sync.*.json"
	],
};
const REGEXP_MAP = {
	".": "\\.", 
	"+": "\\+", 
	"?": "\\?", 
	"[": "\\[", 
	"]": "\\]",
	"^": "^]",
	"$": "$]",
	"*": "[^/]*",
	"**": ".*"
};

export enum State
{
	NOTFOUND,
	INVALID,
	LOADED
}

declare global
{
	interface Error
	{
		suppress?:boolean;
		fsPath?:fs.Path;
		line?:number;
		column?:number;
	}
}

function throwJsonError(data:string, match:RegExp, message:string):never
{
	const matched = data.match(match);
	const err = Error(message);
	if (matched)
	{
		if (matched.index)
		{
			const {line, column} = util.getFilePosition(data, matched.index + matched[0].length);
			err.line = line;
			err.column = column;
		}
	}
	err.suppress = true;
	throw err;
}

function patternToRegExp(pattern:string):RegExp
{
	let regexp = pattern.replace(/([.?+\[\]^$]|\*\*?)/g, chr=>REGEXP_MAP[chr]);
	if (regexp.startsWith("/"))
		regexp = "^" + regexp;
	else
		regexp = ".*/"+regexp;
	if (!regexp.endsWith("/"))
		regexp += "(/.*)?$";
	return new RegExp(regexp);
}

export interface ConfigOptions
{
	host?:string;
	username?:string;
	password?:string;
	keepPasswordInMemory?:boolean;
	remotePath:string;
	protocol:string;
	port?:number;
	fileNameEncoding:string;
	ignoreWrongFileEncoding?:boolean;
	createSyncCache?:boolean;
	autoUpload?:boolean;
	autoDelete?:boolean;
	autoDownload?:boolean;
	disableFtp?:boolean;
	ignore:(string|RegExp)[];

	passphrase?:string;
	connectionTimeout?:number;
	autoDownloadRefreshTime?:number;
	privateKey?:string;

	ftpOverride?:FtpOptions;
	sftpOverride?:SftpOptions;
	logLevel?:log.Level;
}

export function testInitTimeBiasForVSBug():boolean
{
	if (initTimeForVSBug)
	{
		const inittime = initTimeForVSBug;
		initTimeForVSBug = 0;
		if (Date.now() <= inittime + 500)
		{
			return true;
		}
	}
	return false;
}

export class Config implements fs.WorkspaceItem
{
	readonly path:fs.Path;
	public readonly options:ConfigOptions = <any>{};

	public state:State = State.NOTFOUND;
	public lastError:Error|string|null = null;
	private readonly logger:log.Logger;
	private readonly scheduler:work.Scheduler;
	
	public readonly onLoad = event.make<work.Task>();
	public readonly onInvalid = event.make<void>();
	public readonly onNotFound = event.make<void>();
	

	constructor(private workspace:fs.Workspace)
	{
		this.path = workspace.child('./.vscode/ftp-kr.json');

		this.setConfig(CONFIG_BASE);
		this.logger = workspace.query(log.Logger);
		this.scheduler = workspace.query(work.Scheduler);

		switch (workspace.openState)
		{
		case fs.WorkspaceOpenState.OPENED:
			this.load();
			break;
		case fs.WorkspaceOpenState.CREATED:
			break;
		}
	}

	dispose()
	{
	}

	private setConfig(...configs:Object[]):void
	{
		for (const p in this.options)
		{
			delete this.options[p];
		}
		for (const newconf of configs)
		{
			for (const p in newconf)
			{
				const v = newconf[p];
				this.options[p] = (v instanceof Object) ? Object.create(v) : v;
			}
		}
	}

	public async init()
	{
		return this.loadWrap('ftp-kr.init', async(task)=>{
			initTimeForVSBug = Date.now();

			var obj;
			var data:string = '';
			var changed = false;
			try
			{
				data = await this.path.open();
				obj = util.parseJson(data);
				for (var p in CONFIG_INIT)
				{
					if (p in obj) continue;
					obj[p] = CONFIG_INIT[p];
					changed = true;
				}
			}
			catch (err)
			{
				obj = CONFIG_INIT;
				changed = true;
			}
			if (changed)
			{
				data = JSON.stringify(obj, null, 4);
				await this.path.create(data);
			}
			vsutil.open(this.path);
			this.set(data);
		});
	}

	public checkIgnorePath(path:fs.Path):boolean
	{
		const workpath = '/'+path.workpath();
		const check = this.options.ignore;
		for (var i=0;i<check.length;i++)
		{
			var pattern = check[i];
			if (typeof pattern === "string")
			{
				pattern = patternToRegExp(pattern);
			}
			if (pattern.test(workpath))
			{
				return true;
			}
		}
		return false;
	}

	public set(data:string):void
	{
		const obj:ConfigOptions = util.parseJson(data);
		if (!(obj instanceof Object))
		{
			const error = new TypeError("Invalid json data type: "+ typeof obj);
			error.suppress = true;
			throw error;
		}
		if (!obj.disableFtp)
		{
			if ((typeof obj.host) !== 'string')
			{
				throwJsonError(data, /\"host\"[ \t\r\n]*\:[ \t\r\n]*/, 'host field must be string');
			}
			if (!obj.host)
			{
				throwJsonError(data, /\"host\"[ \t\r\n]*\:[ \t\r\n]*/, 'Need host');
			}
			if ((typeof obj.username) !== 'string')
			{
				throwJsonError(data, /\"username\"[ \t\r\n]*\:[ \t\r\n]*/, 'username field must be string');
			}
			if (!obj.username)
			{
				throwJsonError(data, /\"username\"[ \t\r\n]*\:/, 'username field must be string');
			}
			
			if (!obj.remotePath) obj.remotePath = '';
			else if (obj.remotePath.endsWith("/"))
				obj.remotePath = obj.remotePath.substr(0, obj.remotePath.length-1);
			switch (obj.protocol)
			{
			case 'ftps':
			case 'sftp':
			case 'ftp': break;
			default:
				throwJsonError(data, /\"username\"[ \t\r\n]*\:/, `Unsupported protocol "${obj.protocol}"`);
			}
		}
		
		this.logger.setLogLevel(obj.logLevel || 'NORMAL');
		this.setConfig(CONFIG_BASE, obj);
	}

	public setState(newState:State, newLastError:Error|string|null):void
	{
		if (this.state === newState) return;
		this.state = newState;
		this.lastError = newLastError;
		this.logger.verbose(`${this.workspace.name}.state = ${State[newState]}`);
	}

	public load():Thenable<boolean>
	{
		return this.loadWrap('config loading', async(task)=>{
			try
			{
				var data = await this.path.open();
			}
			catch(err)
			{
				throw 'NOTFOUND';
			}
			this.set(data);
		});
	}

	private fireNotFound():Promise<void>
	{
		if (this.state === State.NOTFOUND)
			return Promise.resolve();

		this.setState(State.NOTFOUND, 'NOTFOUND');
		return this.onNotFound.rfire();
	}

	private fireInvalid(err:Error|string):Promise<void>
	{
		if (this.state === State.INVALID)
			return Promise.resolve();

		this.setState(State.INVALID, err);
		return this.onInvalid.fire();
	}

	private fireLoad(task:work.Task):Promise<void>
	{
		return this.onLoad.fire(task).then(()=>{
			this.logger.message("ftp-kr.json: loaded");
			if (this.state !== State.LOADED)
			{
				vsutil.info('');
			}
			this.setState(State.LOADED, null);
		});
	}

	private onLoadError(err):Promise<void>
	{
		switch (err)
		{
		case 'NOTFOUND':
			this.logger.message("ftp-kr.json: not found");
			return this.fireNotFound();
		case 'PASSWORD_CANCEL':
			vsutil.info('ftp-kr Login Request', 'Login').then(confirm=>{
				if (confirm === 'Login')
				{
					this.loadWrap('login', task=>Promise.resolve());
				}
			});
			return this.fireInvalid(err);
		default:
			if (!err.suppress)
			{
				this.logger.message("ftp-kr.json: error");
				this.logger.error(err);
			}
			else
			{
				this.logger.show();
				this.logger.message("ftp-kr.json: "+err.message);
			}
			if (err instanceof Error)
			{
				if (err.line)
				{
					vsutil.open(this.path, err.line, err.column);
				}
				else
				{
					vsutil.open(this.path);
				}
			}	
			return this.fireInvalid(err);
		}
		
	}
	public loadTest():Promise<void>
	{
		if (this.state !== State.LOADED)
		{
			if (this.state === State.NOTFOUND)
			{
				return Promise.reject('Config is not loaded. Retry it after load');
			}
			return this.onLoadError(this.lastError).then(()=>{throw work.CANCELLED;});
		} 
		return Promise.resolve();
	}

	public isFtpDisabled():Promise<void>
	{
		if (this.options.disableFtp)
		{
			vsutil.open(this.path);
			return Promise.reject(new Error("FTP is disabled. Please set disableFtp to false"));
		}
		return Promise.resolve();
	}

	private loadWrap(name:string, onwork:(task:work.Task)=>Promise<void>):Thenable<boolean>
	{
		this.scheduler.cancel();
		var res:boolean = false;
		return this.scheduler.task(name,
			async(task)=>{
				try
				{
					await onwork(task);
					await this.fireLoad(task);
					res = true;
				}
				catch (err)
				{
					await this.onLoadError(err);
				}
			}
		).then(()=>res);
	}
}


fs.onNewWorkspace(workspace=>workspace.query(Config));
