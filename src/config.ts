
import * as fs from "./util/fs";
import * as work from "./util/work";
import * as log from "./util/log";
import * as util from "./util/util";
import * as closure from "./util/closure";
import * as vsutil from "./vsutil";
import {Options as FtpOptions} from 'ftp';
import {ConnectConfig as SftpOptions} from 'ssh2';
import minimatch = require('minimatch');

var initTimeForVSBug:number = 0;

const CONFIG_BASE:Config = {
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
	closure:{
		create_source_map: "%js_output_file%.map",
		output_wrapper: "%output%\n//# sourceMappingURL=%js_output_file_filename%.map",
	}
};
const CONFIG_INIT:Config = {
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
	closure:{
		create_source_map: "%js_output_file%.map",
		output_wrapper: "%output%\n//# sourceMappingURL=%js_output_file_filename%.map",
	}
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

export interface Config
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
	closure:closure.Config;

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

export class WorkspaceConfig
{
	readonly path:fs.Path;
	public readonly options:Config = <any>{};

	public state:State = State.NOTFOUND;
	public lastError:Error|string|null = null;
	public readonly ftpScheduler:work.Scheduler;
	public readonly loadScheduler:work.Scheduler;
	private readonly logger:log.Logger;

	constructor(private workspace:fs.Workspace)
	{
		this.path = workspace.child('./..vscode/ftp-kr.json');

		this.setConfig(CONFIG_BASE);
		this.logger = workspace.item(log.Logger);
		this.ftpScheduler = new work.Scheduler(this.logger, 'ftp');
		this.loadScheduler = new work.Scheduler(this.logger, 'load');
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
		initTimeForVSBug = Date.now();
	
		for(const ws of fs.Workspace.all())
		{
			const config = new WorkspaceConfig(ws);
			await config.init();
		}
		const data:Config = await this.path.initJson(CONFIG_INIT);
		this.set(data);
		vsutil.open(this.path);
	}

	public checkIgnorePath(path:string):boolean
	{
		if(!path.startsWith("/"))
		{
			path = "/" + path;
		}
		
		const check = this.options.ignore;
		for (var i=0;i<check.length;i++)
		{
			var pattern = check[i];
			if (typeof pattern === "string")
			{
				pattern = patternToRegExp(pattern);
			}
			if (pattern.test(path))
			{
				return true;
			}
		}
		return false;
	}

	public set(obj:Config):void
	{
		if (!(obj instanceof Object))
		{
			throw new TypeError("Invalid json data type: "+ typeof obj);
		}
		if (!obj.disableFtp)
		{
			if ((typeof obj.host) !== 'string')
			{
				throw new Error('host field must be string');
			}
			if (!obj.host)
			{
				throw new Error("Need host");
			}
			if ((typeof obj.username) !== 'string')
			{
				throw new Error('username field must be string');
			}
			if (!obj.username)
			{
				throw new Error("Need username");
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
				vsutil.error(`Unsupported protocol "${obj.protocol}", It will treat as ftp`);
				obj.protocol = 'ftp';
				break;
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

	public async load():Promise<void>
	{
		try
		{
			var data = await this.path.open();
		}
		catch(err)
		{
			throw 'NOTFOUND';
		}
		this.set(util.parseJson(data));
	}

}

export function get(workspace:fs.Workspace):Config
{
	const cfg = workspace.item(WorkspaceConfig);
	if (cfg.state !== State.LOADED) throw Error('Config is not loaded yet');
	return cfg.options;
}