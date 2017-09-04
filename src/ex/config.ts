
import {config, ConfigState} from '../config';
import * as work from '../work';
import * as util from '../util';

interface Event
{
	(onfunc:()=>void):void
	
	fire():Promise<void>;
	rfire():Promise<void>;
}

function makeEvent():Event
{
    const list:(()=>void|Promise<void>)[] = [];
	
    const event = <Event>function event(onfunc:()=>void):void
    {
        list.push(onfunc);
    };
    event.fire = async function():Promise<void>
    {
        for(const func of list)
            await func();
    };
    event.rfire = async function():Promise<void>
    {
        for(var i = list.length -1 ; i>= 0; i--)
            await list[i]();
    };
	return event;
}

function fireNotFound():Promise<void>
{
    if (config.state === ConfigState.NOTFOUND)
        return Promise.resolve();

	config.state = ConfigState.NOTFOUND;
	config.lastError = null;
    return onNotFound.rfire();
}

function fireInvalid(err:Error)
{
	const regexp = /^Unexpected token a in JSON at line ([0-9]+), column ([0-9]+)$/;
	if (regexp.test(err.message))
	{
		util.open(config.PATH, +RegExp.$1, +RegExp.$2);
	}
	else
	{
		util.open(config.PATH);
	}
	
    if (config.state === ConfigState.INVALID)
        return Promise.resolve();

    config.state = ConfigState.INVALID;
	config.lastError = err;
    return onInvalid.fire();
}

function fireLoad()
{
    return onLoad.fire()
    .then(function(){
		util.log("ftp-kr.json: loaded");
		if (config.state !== ConfigState.LOADED)
		{
			util.info('');
		}
		config.state = ConfigState.LOADED;
		config.lastError = null;
    });
}

function onLoadError(err)
{
    switch (err)
    {
    case "NOTFOUND":
        util.log("ftp-kr.json: not found");
        return fireNotFound();
    default:
		util.log("ftp-kr.json: error");
		util.error(err);
        return fireInvalid(err);
    }
}

export function loadTest()
{
	if (config.state !== ConfigState.LOADED)
	{
		if (config.state === ConfigState.NOTFOUND) return Promise.reject('Config is not loaded. Retry it after load');
		util.open(config.PATH);
		return Promise.reject(config.lastError);
	} 
	return Promise.resolve();
}

export function isFtpDisabled()
{
	if (config.disableFtp)
	{
		util.open(config.PATH);
		return Promise.reject(new Error("FTP is disabled. Please set disableFtp to false"));
	}
	return Promise.resolve();
}

export function load()
{
	return work.compile.work('config loading',
		()=>work.ftp.work('config loading',
			()=>work.load.work('config loading',
				()=>config.load().then(fireLoad).catch(onLoadError)
			)
		)
	);
}

export function unload()
{
}

export const onLoad = makeEvent();
export const onInvalid = makeEvent();
export const onNotFound = makeEvent();

export const commands = {
	'ftpkr.init'(){
		return work.compile.work('ftpkr.init',
			()=>work.ftp.work('ftpkr.init',
				()=>work.load.work('ftpkr.init',
					()=>config.init().then(fireLoad).catch(onLoadError)
				)
			)
		);
	}
};
