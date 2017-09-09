
import * as cfg from '../config';
import * as work from '../work';
import * as util from '../util';
import * as ftpsync from '../ftpsync';

const config = cfg.config;

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

function fireNotFound():Promise<void>
{
    if (cfg.state === cfg.State.NOTFOUND)
        return Promise.resolve();

	cfg.setState(cfg.State.NOTFOUND, 'NOTFOUND');
    return onNotFound.rfire();
}

function fireInvalid(err:Error|string):Promise<void>
{
	if (err instanceof Error)
	{
		const regexp = /^Unexpected token a in JSON at line ([0-9]+), column ([0-9]+)$/;
		if (regexp.test(err.message))
		{
			util.open(cfg.PATH, +RegExp.$1, +RegExp.$2);
		}
		else
		{
			util.open(cfg.PATH);
		}
	}
	
    if (cfg.state === cfg.State.INVALID)
        return Promise.resolve();

    cfg.setState(cfg.State.INVALID, err);
    return onInvalid.fire();
}

function fireLoad(task:work.Task):Promise<void>
{
    return onLoad.fire(task)
    .then(function(){
		util.message("ftp-kr.json: loaded");
		if (cfg.state !== cfg.State.LOADED)
		{
			util.info('');
		}
		cfg.setState(cfg.State.LOADED, null);
    });
}

function onLoadError(err):Promise<void>
{
    switch (err)
    {
    case 'NOTFOUND':
        util.message("ftp-kr.json: not found");
		return fireNotFound();
	case 'PASSWORD_CANCEL':
		util.info('ftp-kr Login Request', 'Login').then(confirm=>{
			if (confirm === 'Login')
			{
				taskForceRun('login', task=>Promise.resolve());
			}
		});
        return fireInvalid(err);
    default:
		util.message("ftp-kr.json: error");
		if(!err.suppress) util.error(err);
        return fireInvalid(err);
    }
}

export function loadTest():Promise<void>
{
	if (cfg.state !== cfg.State.LOADED)
	{
		if (cfg.state === cfg.State.NOTFOUND)
		{
			return Promise.reject('Config is not loaded. Retry it after load');
		}
		return onLoadError(cfg.lastError).then(()=>{throw work.CANCELLED;});
	} 
	return Promise.resolve();
}

export function isFtpDisabled():Promise<void>
{
	if (config.disableFtp)
	{
		util.open(cfg.PATH);
		return Promise.reject(new Error("FTP is disabled. Please set disableFtp to false"));
	}
	return Promise.resolve();
}

function taskForceRun(name:string, onwork:(task:work.Task)=>Promise<void>):Thenable<void>
{
	work.load.cancel();
	return work.load.task(name,
		()=>{
			work.ftp.throwIfBusy();
			work.compile.throwIfBusy();
			return work.ftp.task(name,
				()=>work.compile.task(name,
					task=>onwork(task).then(()=>fireLoad(task)).catch(onLoadError)
				)
			)
		}
	);
}

export async function load():Promise<void>
{
	taskForceRun('config loading', task=>cfg.load());
}

export function unload():void
{
}

export const onLoad = makeEvent<work.Task>();
export const onInvalid = makeEvent<void>();
export const onNotFound = makeEvent<void>();

export const commands = {
	'ftpkr.init'(task:work.Task){
		taskForceRun('ftpkr.init', task=>cfg.init());
	},
	'ftpkr.cancel'(){
		work.compile.cancel();
		work.ftp.cancel();
		work.load.cancel();
	},
};
