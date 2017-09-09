
import * as fs from "./fs";
import * as util from "./util";
import * as work from "./work";
import {Options as FtpOptions} from 'ftp';
import {ConnectConfig as SftpOptions} from 'ssh2';

const CONFIG_PATH = "/.vscode/ftp-kr.json";
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
		"/.git",
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
	"*": "[^/]*"
};

function regexpchanger(chr:string):string
{
	return REGEXP_MAP[chr];
}
function setConfig(...configs:Object[]):void
{
	for (const p in config)
	{
		delete config[p];
	}
	for (const newconf of configs)
	{
		for (const p in newconf)
		{
			const v = newconf[p];
			config[p] = (v instanceof Object) ? Object.create(v) : v;
		}
	}
}

export function checkIgnorePath(path:string):boolean
{
	if(!path.startsWith("/"))
		path = "/" + path;
	
	const check = config.ignore;
	for (var i=0;i<check.length;i++)
	{
		let pattern = check[i];
		if (typeof pattern === "string")
		{
			let regexp = pattern.replace(/[*.?+\[\]^$]/g, regexpchanger);
			if (regexp.startsWith("/"))
				regexp = "^" + regexp;
			else
				regexp = ".*/"+regexp;
			if (!regexp.endsWith("/"))
				regexp += "(/.*)?$";
			pattern = check[i] = new RegExp(regexp);
		}
		if (pattern.test(path))
			return true;
	}
	return false;
}

export function set(obj:Config):void
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
		
		if (!obj.remotePath) obj.remotePath = '/';
		else if (obj.remotePath.endsWith("/"))
			obj.remotePath = obj.remotePath.substr(0, obj.remotePath.length-1);
		switch (obj.protocol)
		{
		case 'ftps':
		case 'sftp':
		case 'ftp': break;
		default:
			util.error(`Unsupported protocol "${obj.protocol}", It will treat as ftp`);
			obj.protocol = 'ftp';
			break;
		}
	}
	
	util.setLogLevel(obj.logLevel || 'NORMAL');
	setConfig(CONFIG_BASE, obj);
}

export function setState(newState:State, newLastError:Error|string|null):void
{
	if (state === newState) return;
	state = newState;
	lastError = newLastError;
	util.verbose('cfg.state = '+State[newState]);
}

export async function load():Promise<void>
{
	try
	{
		var data = await fs.open(CONFIG_PATH);
	}
	catch(err)
	{
		throw 'NOTFOUND';
	}
	set(util.parseJson(data));
}

export async function init():Promise<void>
{
	initTimeForVSBug = Date.now();
	const data:Config = await fs.initJson(CONFIG_PATH, CONFIG_BASE);
	set(data);
	util.open(CONFIG_PATH);
}

export interface ClosureConfig
{
	js_output_file_filename?:string;
	js?:string[]|string;
	js_output_file?:string;
	generate_exports?:boolean;
	create_source_map?:string;
	output_wrapper?:string;
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
	closure:ClosureConfig;

	passphrase?:string;
	connectionTimeout?:number;
	autoDownloadRefreshTime?:number;
	privateKey?:string;

	ftpOverride?:FtpOptions;
	sftpOverride?:SftpOptions;
	logLevel?:util.LogLevel;
}

export enum State
{
	NOTFOUND,
	INVALID,
	LOADED
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

export const PATH = CONFIG_PATH;
export var state:State = State.NOTFOUND;
export var lastError:Error|string|null = null;
export const config:Config = <any>{};
setConfig(CONFIG_BASE);
