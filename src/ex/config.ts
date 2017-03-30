
import config from '../config';
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
    if (config.state === "NOTFOUND")
        return Promise.resolve();

    config.state = "NOTFOUND";
    return onNotFound.rfire();
}

function fireInvalid()
{
    if (config.state === "INVALID")
        return Promise.resolve();

    config.state = "INVALID";
    return onInvalid.fire();
}

function fireLoad()
{
    return onLoad.fire()
    .then(function(){
        util.log("ftp-kr.json: loaded");
        config.state = "LOADED";
    })
    .catch(function(err){
        util.error(err);
        util.open(config.PATH);
        return Promise.reject("INVALID");
    });
}

function onLoadError(err)
{
    switch (err)
    {
    case "NOTFOUND":
        util.log("ftp-kr.json: not found");
        return fireNotFound();
    case "INVALID":
        util.log("ftp-kr.json: invalid");
        return fireInvalid();
    default:
        util.error(err);
        return;
    }
}

export function loadTest()
{
	if (config.state !== 'LOADED')
	{
		if (config.state === 'NOTFOUND') return Promise.reject('Config is not loaded');
		util.open(config.PATH);
		return Promise.reject(new Error("Need to fix"));
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
	return work.compile.add(
		()=>work.ftp.add(
			()=> work.load.add(
				()=>config.load().then(fireLoad)
			).end()
		).end()
	).catch(onLoadError);
}

export function unload()
{
}

export const onLoad = makeEvent();
export const onInvalid = makeEvent();
export const onNotFound = makeEvent();

export const commands = {
	'ftpkr.init'(){
		return work.compile.add(
			()=>work.ftp.add(
				()=> work.load.add(
					()=>config.init().then(fireLoad)
				).end()
			).end()
		).catch(onLoadError);
	}
};
