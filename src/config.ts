

import { File } from 'krfile';
import 'krjson';
import { Event } from './util/event';
import { FtpKrConfig } from './util/ftpkr_config';
import { FtpKrConfigProperties } from './util/serverinfo';
import { processError } from './vsutil/error';
import { Logger } from './vsutil/log';
import { vsutil } from './vsutil/vsutil';
import { Scheduler, Task } from './vsutil/work';
import { Workspace, WorkspaceItem } from './vsutil/ws';

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

export class Config extends FtpKrConfig implements WorkspaceItem
{
	public state:ConfigState = ConfigState.NOTFOUND;
	public lastError:Error|string|null = null;

	public basePath:File;
	
	public readonly onLoad = Event.make<Task>(false);
	public readonly onLoadAfter = Event.make<void>(false);
	public readonly onInvalid = Event.make<void>(false);
	public readonly onNotFound = Event.make<void>(true);
	
	private ignorePatterns:(RegExp[])|null = null;
	private readonly logger:Logger;
	private readonly scheduler:Scheduler;
	
	constructor(private workspace:Workspace)
	{
		super(workspace);

		this.logger = workspace.query(Logger);
		this.scheduler = workspace.query(Scheduler);

		this.basePath = <any>undefined;
	}

	dispose()
	{
	}

	public async modifySave(cb:(cfg:FtpKrConfigProperties)=>void):Promise<void>
	{
		const json = await this.path.json();
		cb(json);
		cb(this);
		await this.path.create(JSON.stringify(json, null, 4));
	}


	public updateIgnorePath():void
	{
		this.ignorePatterns = null;
	}

	/**
	 * if true, path needs to ignore
	 */
	public checkIgnorePath(path:File):boolean
	{
		if (!this.ignorePatterns)
		{
			this.ignorePatterns = this.ignore.map(patternToRegExp);
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
		this.loadWrap('init', async(task)=>{
			await this.initJson();
			vsutil.open(this.path);
		});
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
		this.loadWrap('config loading', task=>this.readJson());
	}

	private fireNotFound():Promise<void>
	{
		if (this.state === ConfigState.NOTFOUND)
			return Promise.resolve();

		this.setState(ConfigState.NOTFOUND, 'NOTFOUND');
		return this.onNotFound.fire();
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
			this.logger.message('/.vscode/ftp-kr.json: loaded');
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
			this.logger.message('/.vscode/ftp-kr.json: not found');
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

	private async loadWrap(name:string, onwork:(task:Task)=>Promise<void>):Promise<void>
	{
		await this.scheduler.cancel();
		try
		{
			await this.scheduler.taskMust(name, async(task)=>{
				try
				{
					await onwork(task);
	
					this.ignorePatterns = null;
					if (this.localBasePath)
					{
						this.basePath = this.workspace.child(this.localBasePath);
					}
					else
					{
						this.basePath = this.workspace;
					}
	
					this.logger.dontOpen = this.dontOpenOutput;
					this.logger.setLogLevel(this.logLevel);
	
					await this.fireLoad(task);
				}
				catch (err)
				{
					await this.onLoadError(err);
				}
			});
			await this.onLoadAfter.fire();
		}
		catch (err)
		{
			await processError(this.logger, err);
		}
	}
}
