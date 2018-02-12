

import minimatch = require('minimatch');
import { File } from 'krfile';
import 'krjson';

import * as util from "./util/util";
import * as event from "./util/event";

import { ConfigContainer } from './util/config';
import { ServerConfig } from './util/fileinfo';
import { ftp_path } from './util/ftp_path';
import { PRIORITY_NORMAL, Task, Scheduler } from './vsutil/work';
import { vsutil } from './vsutil/vsutil';
import { processError } from './vsutil/error';
import { Logger, LogLevel } from './vsutil/log';
import { WorkspaceItem, Workspace } from './vsutil/ws';
import { Event } from './util/event';
import { parseJson } from 'krjson';
import { keys } from './util/keys';

var initTimeForVSBug:number = 0;

const DEFAULT_IGNORE_LIST = [
	".git",
	"/.vscode/chrome",
	"/.vscode/.key",
	"/.vscode/ftp-kr.task.json",
	"/.vscode/ftp-kr.error.log",
	"/.vscode/ftp-kr.sync.*.json",
	"/.vscode/ftp-kr.diff.*"
];

const CONFIG_INIT:ConfigProperties = <any>{
	host: "",
	username: "",
	password: "",
	remotePath: "",
	protocol: "ftp",
	port: 0,
	fileNameEncoding: "utf8", 
	autoUpload: true,
	autoDelete: false,
	autoDownload: false,
	ignore:DEFAULT_IGNORE_LIST,
};
const REGEXP_MAP:{[key:string]:string} = {
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

export enum ConfigState
{
	NOTFOUND,
	INVALID,
	LOADED
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

function findUndupplicatedSet<T>(dupPriority:(keyof T)[], obj:T, objs:T[]):string[]
{
	const dupmap:{[key:string]:Set<T>} = {};
	for (const prop of dupPriority)
	{
		const set = new Set;
		const value = obj[prop];
		for (const other of objs)
		{
			if (other === obj) continue;
			if (other[prop] === value)
			{
				set.add(other);
				break;
			}
		}
		dupmap[prop] = set;
	}

	function testDup(keys:string[]):boolean
	{
		_notdup:for (const other of objs)
		{
			if (other === obj) continue;
			for (const key of keys)
			{
				if (dupmap[key].has(other)) continue;
				continue _notdup;
			}
			return false;
		}
		return true;
	}

	const all = 1 << dupPriority.length;
	for (var i=1;i<all;i++)
	{
		var v = i;
		const arr:string[] = [];
		for (const prop of dupPriority)
		{
			if (v & 1) arr.push(prop);
			v >>= 1;
		}
		if (testDup(arr)) return arr;
	}
	return [];
}

interface ConfigProperties extends ServerConfig
{
	ignore:string[];
	autoUpload:boolean;
	autoDelete:boolean;
	autoDownload:boolean;
	
	altServer:ServerConfig[];
	localBasePath?:string;
	followLink:boolean;
	autoDownloadAlways:number;
	createSyncCache:boolean;
	logLevel:LogLevel;
	viewSizeLimit:number;
	downloadTimeExtraThreshold:number;
	ignoreRemoteModification:boolean;
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

class ConfigClass extends ConfigContainer<ConfigProperties> implements WorkspaceItem
{
	public readonly path:File;

	public state:ConfigState = ConfigState.NOTFOUND;
	public lastError:Error|string|null = null;

	public basePath:File;
	
	public readonly onLoad = Event.make<Task>('onLoad');
	public readonly onInvalid = Event.make<void>('onInvalid');
	public readonly onNotFound = Event.make<void>('onNotFound');
	
	private ignorePatterns:(RegExp[])|null = null;
	private readonly logger:Logger;
	private readonly scheduler:Scheduler;
	private readonly config:Config = <Config><any>this;
	
	constructor(private workspace:Workspace)
	{
		super(keys<ConfigProperties>());

		this.path = workspace.child('./.vscode/ftp-kr.json');

		this.logger = workspace.query(Logger);
		this.scheduler = workspace.query(Scheduler);
		this._configTypeClearing();

		this.basePath = <any>undefined;
	}

	dispose()
	{
	}

	private _serverTypeClearing(config:ServerConfig, index:number):void
	{
		if (typeof config.remotePath !== 'string') config.remotePath = '.';
		else if (!config.remotePath) config.remotePath = '.';
		else if (config.remotePath.endsWith("/"))
			config.remotePath = ftp_path.normalize(config.remotePath.substr(0, config.remotePath.length-1));

		if (typeof config.protocol !== 'string') config.protocol = "ftp";
		if (typeof config.fileNameEncoding !== 'string') config.fileNameEncoding = 'utf8';
	
		if (typeof config.host !== 'string') config.host = config.host+'';
		if (typeof config.username !== 'string') config.username = config.username+'';
		if ("port" in config) config.port = (config.port || 0)|0;
		config.ignoreWrongFileEncoding = config.ignoreWrongFileEncoding === true;
		if ('name' in config) config.name = config.name+'';

		if ("password" in config) config.password = config.password+'';
		config.keepPasswordInMemory = config.keepPasswordInMemory !== false;
		
		if ("passphrase" in config) config.passphrase = config.passphrase +'';
		config.connectionTimeout = Number(config.connectionTimeout || 60000);
		config.autoDownloadRefreshTime = config.refreshTime = Number(config.refreshTime || config.autoDownloadRefreshTime || 1000);
		config.blockDetectingDuration = Number(config.blockDetectingDuration || 8000);
		if ("privateKey" in config) config.privateKey = config.privateKey+'';
		config.showGreeting = config.showGreeting === true;
		if (typeof config.ftpOverride !== 'object') delete config.ftpOverride;
		if (typeof config.sftpOverride !== 'object') delete config.sftpOverride;
			
		// generate field
		config.index = index;
		var url = config.protocol;
		url += '://';
		url += config.host;
		if (config.port)
		{
			url += ':';
			url += config.port;
		}
		url += '/';
		url += config.remotePath;
		config.url = url;
		
		var hostUrl = config.protocol;
		hostUrl += '://';
		hostUrl += config.host;
		if (config.port)
		{
			hostUrl += ':';
			hostUrl += config.port;
		}
		hostUrl += '@';
		hostUrl += config.username;
		config.hostUrl = hostUrl;

		delete config.passwordInMemory;
	}

	private _configTypeClearing():void
	{
		// x !== false : default is true
		// x === true : default is false

		const config = this.config;
		if (!(config.ignore instanceof Array)) config.ignore = DEFAULT_IGNORE_LIST;
		config.autoUpload = config.autoUpload === true;
		config.autoDelete = config.autoDelete === true;
		config.autoDownload = config.autoDownload === true;
		if (!(config.altServer instanceof Array)) config.altServer = [];
		if ((typeof config.localBasePath === 'string') && config.localBasePath)
		{
			this.basePath = this.workspace.child(config.localBasePath);
		}
		else
		{
			this.basePath = this.workspace;
			delete config.localBasePath;
		}
		config.followLink = config.followLink === true;
		if ('autoDownloadAlways' in config) config.autoDownloadAlways = Number(config.autoDownloadAlways || 0);
		config.createSyncCache = config.createSyncCache !== false;
		switch (config.logLevel)
		{
		case 'VERBOSE':
		case 'NORMAL':
		case 'ERROR':
			this.logger.setLogLevel(config.logLevel);
			break;
		default:
			this.logger.setLogLevel('NORMAL');
			config.logLevel = 'NORMAL';
			break;
		}
		config.viewSizeLimit = Number(config.viewSizeLimit || 1024*1024*4)
		config.downloadTimeExtraThreshold = Number(config.downloadTimeExtraThreshold || 1000);
		config.ignoreRemoteModification = config.ignoreRemoteModification === true;
		delete config.name;

		this._serverTypeClearing(config, 0);
		for (var i=0;i<config.altServer.length;)
		{
			if (typeof config.altServer[i] !== 'object')
			{
				config.altServer.splice(i, 1);
			}
			else
			{
				const altcfg = config.altServer[i++];
				this._serverTypeClearing(altcfg, i);
			}
		}
	}

	public checkIgnorePath(path:File):boolean
	{
		if (!this.ignorePatterns)
		{
			this.ignorePatterns = this.config.ignore.map(patternToRegExp);
		}


		const pathFromWorkspace = '/'+path.relativeFrom(this.workspace);
		for (const pattern of this.ignorePatterns)
		{
			if (pattern.test(pathFromWorkspace))
			{
				return true;
			}
		}
		return false;
	}

	public init():void
	{
		this.loadWrap('ftp-kr.init', async(task)=>{
			initTimeForVSBug = Date.now();

			var obj;
			var data:string = '';
			var changed = false;
			try
			{
				data = await this.path.open();
				obj = parseJson(data);
				for (const p in CONFIG_INIT)
				{
					if (p in obj) continue;
					changed = true;
					break;
				}
				Object.assign(obj, CONFIG_INIT);
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

	public set(data:string):void
	{
		var obj:ConfigProperties;
		try
		{
			obj = parseJson(data);
		}
		catch(err)
		{
			err.file = this.path;
			throw err;
		}
		if (!(obj instanceof Object))
		{
			const error = new TypeError("Invalid json data type: "+ typeof obj);
			error.suppress = true;
			throw error;
		}
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
		
		switch (obj.protocol)
		{
		case 'ftps':
		case 'sftp':
		case 'ftp': break;
		default:
			throwJsonError(data, /\"username\"[ \t\r\n]*\:/, `Unsupported protocol "${obj.protocol}"`);
		}
		this.clearConfig();
		this.appendConfig(obj);
		const config = this.config;

		if (!config.altServer || config.altServer.length === 0)
		{
			this._configTypeClearing();
			return;
		}

		const dupPriority:(keyof ServerConfig)[] = ['name', 'host', 'protocol', 'port', 'remotePath', 'username'];
		const servers = config.altServer;
		
		function removeFullDupped():void
		{
			const fulldupped = new Set<string>();
			_fullDupTest:for (const prop of dupPriority)
			{
				for (const server of servers)
				{
					if (!(prop in server)) continue;
					if (config[prop] !== server[prop]) continue _fullDupTest;
				}
				fulldupped.add(prop);
			}
			for (var i=0; i<dupPriority.length;)
			{
				if (fulldupped.has(dupPriority[i]))
				{
					dupPriority.splice(i, 1);
				}
				else
				{
					i++;
				}
			}
		}

		removeFullDupped();

		for (const server of servers)
		{
			// copy main config
			for(const p of this.properties)
			{
				if (!(p in server))
				{
					(<any>server)[p] = util.clone(config[p]);
				}
			}

			// make dupmap
			var usedprop:string[] = findUndupplicatedSet(dupPriority, server, servers);
			const nameidx = usedprop.indexOf('name');
			if (nameidx !== -1) usedprop.splice(nameidx, 1);

			var altname = '';
			if (usedprop.length !== 0)
			{
				if (server.host) altname = server.host;
				for (const prop of usedprop)
				{
					switch (prop)
					{
					case 'protocol':
						altname = server.protocol + '://' + altname;
						break;
					case 'port':
						altname += ':'+server.port;
						break;
					case 'remotePath':
						altname += '/'+server.remotePath;
						break;
					case 'username':
						altname += '@'+server.username;
						break;
					}
				}
			}
			if (altname)
			{
				if (server.name) server.name += `(${altname})`;
				else server.name = altname;
			}
			else
			{
				if (!server.name) server.name = server.host || '';
			}
		}

		this._configTypeClearing();
	}

	public setState(newState:ConfigState, newLastError:Error|string|null):void
	{
		if (this.state === newState) return;
		this.state = newState;
		this.lastError = newLastError;
		this.logger.verbose(`${this.workspace.name}.state = ${ConfigState[newState]}`);
	}

	public load():void
	{
		this.loadWrap('config loading', async(task)=>{
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
		if (this.state === ConfigState.NOTFOUND)
			return Promise.resolve();

		this.setState(ConfigState.NOTFOUND, 'NOTFOUND');
		return this.onNotFound.rfire();
	}

	private fireInvalid(err:Error|string):Promise<void>
	{
		if (this.state === ConfigState.INVALID)
			return Promise.resolve();

		this.setState(ConfigState.INVALID, err);
		return this.onInvalid.fire();
	}

	private fireLoad(task:Task):Promise<void>
	{
		return this.onLoad.fire(task).then(()=>{
			this.logger.message("ftp-kr.json: loaded");
			if (this.state !== ConfigState.LOADED)
			{
				vsutil.info('');
			}
			this.setState(ConfigState.LOADED, null);
		});
	}

	private async onLoadError(err:any):Promise<void>
	{
		switch (err)
		{
		case 'NOTFOUND':
			this.logger.message("ftp-kr.json: not found");
			await this.fireNotFound();
			throw 'IGNORE';
		case 'PASSWORD_CANCEL':
			vsutil.info('ftp-kr Login Request', 'Login').then(confirm=>{
				if (confirm === 'Login')
				{
					this.loadWrap('login', task=>Promise.resolve());
				}
			});
			await this.fireInvalid(err);
			throw 'IGNORE';
		default:
			if (err instanceof Error) err.file = this.path;
			await this.fireInvalid(err);
			throw err;
		}
	}

	public loadTest():Promise<void>
	{
		if (this.state !== ConfigState.LOADED)
		{
			if (this.state === ConfigState.NOTFOUND)
			{
				return Promise.reject('Config is not loaded. Retry it after load');
			}
			return this.onLoadError(this.lastError);
		} 
		return Promise.resolve();
	}

	/**
	 * path from localBasePath
	 */
	public workpath(file:File):string
	{
		const workpath = file.relativeFrom(this.basePath);
		if (workpath === undefined)
		{
			if (this.basePath !== this.workspace)
			{
				throw Error(`${file.fsPath} is not in localBasePath`);
			}
			else
			{
				throw Error(`${file.fsPath} is not in workspace`);
			}
		}
		return '/'+workpath;
	}

	public fromWorkpath(workpath:string, parent:File):File
	{
		if (workpath.startsWith('/'))
		{
			return this.basePath.child(workpath.substr(1));
		}
		else
		{
			return parent.child(workpath);
		}
	}

	private loadWrap(name:string, onwork:(task:Task)=>Promise<void>):void
	{
		this.scheduler.cancel();
		this.scheduler.task(name,
			PRIORITY_NORMAL,
			async(task)=>{
				try
				{
					await onwork(task);
					await this.fireLoad(task);
				}
				catch (err)
				{
					await this.onLoadError(err);
				}
			}
		)
		.catch(err=>processError(this.logger, err));
	}
}

export const Config:{new(workspace:Workspace):ConfigClass&ConfigProperties} = <any>ConfigClass;
export type Config = ConfigClass & ConfigProperties;
