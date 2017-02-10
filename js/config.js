
const fs = require("./fs");
const util = require("./util");
const stripJsonComments = require('strip-json-comments');

const CONFIG_PATH = "/.vscode/ftp-kr.json";

const CONFIG_BASE = {
    "host": "",
    "username": "",
    "password": "",
    "remotePath": "",
	"protocol": "ftp",
	"port": 0,
    "fileNameEncoding": "utf8", 
    "ignoreWrongFileEncoding": false,
    "createSyncCache": true, 
    "autoUpload": true,
    "autoDelete": false,
	"autoDownload": false,
	"disableFtp": false,
    "ignore":[
        "/.git",
        "/.vscode/ftp-kr.task.json",
        "/.vscode/ftp-kr.error.log",
        "/.vscode/ftp-kr.sync.*.json"
    ],
    "closure":{
        "create_source_map": "%js_output_file%.map",
        "output_wrapper": "%output%\n//# sourceMappingURL=%js_output_file_filename%.map",
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
function regexpchanger(chr)
{
    return REGEXP_MAP[chr];
}
function setConfig(newobj)
{
    for(const p in newobj)
    {
        const v = newobj[p];
        config[p] = (v instanceof Object) ? Object.create(v) : v;
    }
}

const config = module.exports = {
    PATH: CONFIG_PATH,

    state: 'NOTFOUND',
    
    /**
     * @param {string} path
     * @return {boolean}
     */
    checkIgnorePath(path)
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
    },

    /**
     * @param {Object} obj
     * @returns {!Promise}
     */
    set(obj)
    {
        try
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

            if (config.remotePath.endsWith("/"))
                config.remotePath = config.remotePath.substr(0, config.remotePath.length-1);
			if (!("autoDownloadRefreshTime" in config))
			{
				config.autoDownloadRefreshTime = 1000;
			}

            return Promise.resolve();
        }
        catch(err)
        {
            return Promise.reject(err);
        }
    },

    /**
     * @returns {!Promise.<boolean>}
     */
    load()
    {
        return new Promise(function(resolve, reject){
            fs.open(CONFIG_PATH)
            .then((data) => 
            {
                Promise.resolve()
                .then(() => config.set(JSON.parse(stripJsonComments(data))))
                .then(() => resolve())
                .catch((err) => {
                    util.error(err);
                    util.open(CONFIG_PATH);
                    reject("INVALID");
                 });
            })
            .catch(()=> { reject("NOTFOUND") });
        });
    },

    /**
     * @returns {!Promise}
     */
    init()
    {
        return fs.initJson(CONFIG_PATH, CONFIG_BASE)
        .then((obj) => config.set(obj))
        .catch(function(err){
            util.error(err);
            util.open(CONFIG_PATH);
            return Promise.reject('INVALID');
        })
        .then(() => util.open(CONFIG_PATH));
    }
};

setConfig(CONFIG_BASE);
