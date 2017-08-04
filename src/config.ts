
import * as fs from "./fs";
import * as util from "./util";

const CONFIG_PATH = "/.vscode/ftp-kr.json";

const CONFIG_BASE:Config = {
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
function setConfig(newobj:Object):void
{
    for(const p in newobj)
    {
        const v = newobj[p];
        config[p] = (v instanceof Object) ? Object.create(v) : v;
    }
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

import {Options as FtpOptions} from 'ftp';
import {ConnectConfig as SftpOptions} from 'ssh2';

export interface Config
{
	host:string;
	username:string;
	password?:string;
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
	ignore?:(string|RegExp)[];
	closure:ClosureConfig;

	passphrase?:string;
	connectionTimeout?:number;
	autoDownloadRefreshTime?:number;
	privateKey?:string;

	ftpOverride?:FtpOptions,
	sftpOverride?:SftpOptions,
}

class ConfigNamespace
{
    PATH:string = CONFIG_PATH;
	state:string = 'NOTFOUND';
	lastError:(Error|null) = null;
	ignore:(string|RegExp)[];
	initTimeForVSBug:number = 0;

	username:string;
	host:string;
	remotePath:string;
	protocol:string;
	fileNameEncoding:string;
	closure:ClosureConfig = {};

	constructor()
	{
	}
	
    checkIgnorePath(path:string):boolean
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

    set(obj:Config):void
    {
		if (!(obj instanceof Object))
		{
			throw new TypeError("Invalid json data type: "+ typeof obj);
		}
		if (!obj.disableFtp)
		{
			if (!obj.host)
			{
				throw new Error("Need host");
			}
			if (!obj.username)
			{
				throw new Error("Need username");
			}
		}
		
		setConfig(obj);

		if (!config.remotePath) config.remotePath = '/';
		else if (config.remotePath.endsWith("/"))
			config.remotePath = config.remotePath.substr(0, config.remotePath.length-1);
		switch (config.protocol)
		{
		case 'ftps':
		case 'sftp':
		case 'ftp': break;
		default:
			util.error(`Unsupported protocol "${config.protocol}", It will treat as ftp`);
			config.protocol = 'ftp';
			break;
		}
    }

    async load():Promise<void>
    {
		try
		{
			var data = await fs.open(CONFIG_PATH);
		}
		catch(err)
		{
			throw 'NOTFOUND';
		}
		config.set(util.parseJson(data));
    }

    async init():Promise<void>
    {
		config.initTimeForVSBug = Date.now();
		const data:Config = await fs.initJson(CONFIG_PATH, CONFIG_BASE);
		config.set(data);
		util.open(CONFIG_PATH);
    }
}

export const config:ConfigNamespace&Config = new ConfigNamespace;

export default config;

setConfig(CONFIG_BASE);
