

import minimatch = require('minimatch');

import * as util from "./util/util";
import * as event from "./util/event";
import {File} from "./util/file";
import {ConfigContainer} from './util/config';

import * as ws from "./vsutil/ws";
import * as work from "./vsutil/work";
import * as log from "./vsutil/log";
import * as vsutil from "./vsutil/vsutil";
import { ServerConfig } from './util/fileinfo';
import { ftp_path } from './util/ftp_path';

var initTimeForVSBug:number = 0;


const SERVER_CONFIG_BASE:ServerConfig = {
	host: "",
	username: "",
	remotePath: "",
	protocol: "ftp",
	port: 0,
	fileNameEncoding: "utf8", 
	ignoreWrongFileEncoding: false,
};

const CONFIG_BASE:ConfigProperties = {
	host: "",
	username: "",
	remotePath: "",
	protocol: "ftp",
	port: 0,
	fileNameEncoding: "utf8", 
	ignoreWrongFileEncoding: false,
	autoUpload: true,
	autoDelete: false,
	autoDownload: false,
	ignore:[
		".git",
		"/.vscode/chrome",
		"/.vscode/.key",
		"/.vscode/ftp-kr.task.json",
		"/.vscode/ftp-kr.error.log",
		"/.vscode/ftp-kr.sync.*.json"
	],
};
const CONFIG_INIT:ConfigProperties = {
	host: "",
	username: "",
	password: "",
	remotePath: "",
	protocol: "ftp",
	port: 0,
	fileNameEncoding: "utf8", 
	ignoreWrongFileEncoding: false,
	autoUpload: true,
	autoDelete: false,
	autoDownload: false,
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

function findUndupplicatedSet<T>(dupPriority:string[], obj:T, objs:T[]):string[]
{
	const dupmap:{[key:string]:Set<ServerConfig>} = {};
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
	ignore?:(string|RegExp)[];
	altServer?:ServerConfig[];
	localBasePath?:string;
	followLink?:boolean;
	autoUpload?:boolean;
	autoDelete?:boolean;
	autoDownload?:boolean;
	autoDownloadAlways?:number;
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

class ConfigClass extends ConfigContainer implements ws.WorkspaceItem
{
	public readonly path:File;

	public state:State = State.NOTFOUND;
	public lastError:Error|string|null = null;

	public basePath:File;
	
	public readonly onLoad = event.make<work.Task>();
	public readonly onInvalid = event.make<void>();
	public readonly onNotFound = event.make<void>();
	
	private readonly logger:log.Logger;
	private readonly scheduler:work.Scheduler;
	
	constructor(private workspace:ws.Workspace)
	{
		super();

		this.path = workspace.child('./.vscode/ftp-kr.json');

		this.appendConfig(CONFIG_BASE);
		this.logger = workspace.query(log.Logger);
		this.scheduler = workspace.query(work.Scheduler);
	}

	dispose()
	{
	}

	public checkIgnorePath(path:File):boolean
	{
		const config:Config = this;

		const pathFromWorkspace = '/'+path.relativeFrom(this.workspace);
		const check = config.ignore;
		if (check)
		{
			for (var i=0;i<check.length;i++)
			{
				var pattern = check[i];
				if (typeof pattern === "string")
				{
					pattern = patternToRegExp(pattern);
				}
				if (pattern.test(pathFromWorkspace))
				{
					return true;
				}
			}
		}
		return false;
	}

	* getAltServers():Iterable<ServerConfig>
	{
		const options:Config&ConfigProperties = this;
		if (options.altServer)
		{
			yield * options.altServer;
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

	public set(data:string):void
	{
		var obj:ConfigProperties;
		try
		{
			obj = util.parseJson(data);
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
		
		if (!obj.remotePath) obj.remotePath = '.';
		else if (obj.remotePath.endsWith("/"))
			obj.remotePath = ftp_path.normalize(obj.remotePath.substr(0, obj.remotePath.length-1));
		switch (obj.protocol)
		{
		case 'ftps':
		case 'sftp':
		case 'ftp': break;
		default:
			throwJsonError(data, /\"username\"[ \t\r\n]*\:/, `Unsupported protocol "${obj.protocol}"`);
		}
		
		this.logger.setLogLevel(obj.logLevel || 'NORMAL');
		this.clearConfig();
		this.appendConfig(CONFIG_BASE);
		this.appendConfig(obj);
		const config:Config = this;

		if (config.localBasePath) this.basePath = this.workspace.child(config.localBasePath);
		else this.basePath = this.workspace;

		if (!config.altServer) return;

		const dupPriority = ['name', 'host', 'protocol', 'port', 'remotePath', 'username'];
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
			for(const p of this.settedProperties)
			{
				if (!(p in server))
				{
					server[p] = util.clone(this[p]);
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

	private async onLoadError(err):Promise<void>
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
		if (this.state !== State.LOADED)
		{
			if (this.state === State.NOTFOUND)
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
		return workpath;
	}

	private loadWrap(name:string, onwork:(task:work.Task)=>Promise<void>):Thenable<boolean>
	{
		this.scheduler.cancel();
		var res:boolean = false;
		return this.scheduler.task(name,
			work.NORMAL,
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

export const Config:{new(workspace:ws.Workspace):ConfigClass&ConfigProperties} = ConfigClass;
export type Config = ConfigClass & ConfigProperties;
