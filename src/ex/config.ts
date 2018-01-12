
import * as fs from '../util/fs';
import * as log from '../util/log';
import * as work from '../util/work';
import * as vsutil from '../util/vsutil';
import * as cfg from '../config';
import * as ftpsync from '../ftpsync';
import * as closure from '../closure';

interface Event<T>
{
	(onfunc:(value:T)=>void):void
	
	fire(value?:T):Promise<void>;
	rfire(value?:T):Promise<void>;
}

function makeEvent<T>():Event<T>
{
    const list:((value:T)=>void|Promise<void>)[] = [];
	
    const event = <Event<T>>function event(onfunc:()=>void):void
    {
        list.push(onfunc);
    };
    event.fire = async function(value:T):Promise<void>
    {
        for(const func of list)
            await func(value);
    };
    event.rfire = async function(value:T):Promise<void>
    {
        for(var i = list.length -1 ; i>= 0; i--)
            await list[i](value);
    };
	return event;
}

class ConfigManager
{
	private readonly config:cfg.WorkspaceConfig;
	private readonly logger:log.Logger;	
	
	constructor(private workspace:fs.Workspace)
	{
		this.config = workspace.item(cfg.WorkspaceConfig);
		this.logger = workspace.item(log.Logger);
	}

	private fireNotFound():Promise<void>
	{
		if (this.config.state === cfg.State.NOTFOUND)
			return Promise.resolve();

		this.config.setState(cfg.State.NOTFOUND, 'NOTFOUND');
		return onNotFound.rfire();
	}

	private fireInvalid(err:Error|string):Promise<void>
	{
		if (err instanceof Error)
		{
			const regexp = /^Unexpected token a in JSON at line ([0-9]+), column ([0-9]+)$/;
			if (regexp.test(err.message))
			{
				vsutil.open(this.config.path, +RegExp.$1, +RegExp.$2);
			}
			else
			{
				vsutil.open(this.config.path);
			}
		}
		
		if (this.config.state === cfg.State.INVALID)
			return Promise.resolve();

		this.config.setState(cfg.State.INVALID, err);
		return onInvalid.fire();
	}

	private fireLoad(task:work.Task):Promise<void>
	{
		return onLoad.fire(task).then(()=>{
			this.logger.message("ftp-kr.json: loaded");
			if (this.config.state !== cfg.State.LOADED)
			{
				vsutil.info('');
			}
			this.config.setState(cfg.State.LOADED, null);
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
					this.taskForceRun('login', task=>Promise.resolve());
				}
			});
			return this.fireInvalid(err);
		default:
			this.logger.message("ftp-kr.json: error");
			if(!err.suppress) this.logger.error(err);
			return this.fireInvalid(err);
		}
	}

	private loadTest():Promise<void>
	{
		if (this.config.state !== cfg.State.LOADED)
		{
			if (this.config.state === cfg.State.NOTFOUND)
			{
				return Promise.reject('Config is not loaded. Retry it after load');
			}
			return this.onLoadError(this.config.lastError).then(()=>{throw work.CANCELLED;});
		} 
		return Promise.resolve();
	}

	private isFtpDisabled():Promise<void>
	{
		if (this.config.options.disableFtp)
		{
			vsutil.open(this.config.path);
			return Promise.reject(new Error("FTP is disabled. Please set disableFtp to false"));
		}
		return Promise.resolve();
	}

	public taskForceRun(name:string, onwork:(task:work.Task)=>Promise<void>):Thenable<void>
	{
		this.config.loadScheduler.cancel();
		return this.config.loadScheduler.task(name,
			()=>{
				return this.config.ftpScheduler.taskWithTimeout(name, 1000,
					()=>work.compile.taskWithTimeout(name, 1000,
						task=>onwork(task).then(()=>this.fireLoad(task)).catch(err=>this.onLoadError(err))
					)
				)
			}
		);
	}
}

export async function load():Promise<void>
{
	for(const workspace of fs.Workspace.all())
	{
		workspace.item(ConfigManager).taskForceRun('config loading', task=>this.config.load());
	}
}

export function unload():void
{
}

export const onLoad = makeEvent<work.Task>();
export const onInvalid = makeEvent<void>();
export const onNotFound = makeEvent<void>();

export const commands = {
	async 'ftpkr.init'(){
		const ws = await vsutil.selectWorkspace();
		if (ws === null)  return;
		ws.item(ConfigManager).taskForceRun('ftpkr.init', task=>cfg.init());
	},
	'ftpkr.cancel'(){
		work.compile.cancel();
		this.ftp.cancel();
		this.load.cancel();
	},
};
