
const fs = require("./fs");
const util = require("./util");
const stripJsonComments = require('strip-json-comments');

const CONFIG_PATH = "/.vscode/ftp-kr.json";

const CONFIG_BASE = {
    "host": "",
    "username": "",
    "password": "",
    "remotePath": "",
    "port": 21,
    "fileNameEncoding": "utf8", 
    "ignoreWrongFileEncoding": false,
    "createSyncCache": true, 
    "autoUpload": true,
    "autoDelete": false,
	"disableFtp": false,
    "ignore":[
        "/.git",
        "/.vscode/ftp-kr.task.json",
        "/.vscode/ftp-kr.error.log",
        "/.vscode/ftp-kr.sync.*.json"
    ],
    "closure":{
        "compilation_level": "ADVANCED",
        "source_map_location_mapping": "d:/|file:///D:/",
        "warning_level": "VERBOSE",
        "create_source_map": "%js_output_file%.map",
        "output_wrapper": "(function(){%output%}).call(this);\n//# sourceMappingURL=%js_output_file_filename%.map",
        "language_in": "ECMASCRIPT5_STRICT",
        "language_out": "ECMASCRIPT5_STRICT",
        "summary_detail_level": 3,
        "assume_function_wrapper": true,
        "use_types_for_optimization": true,
        "process_closure_primitives": "false"
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
    checkIgnorePath: function(path)
    {
        if(!path.startsWith("/"))
            path = "/" + path;
        
        var check = config.ignore;
        for (var i=0;i<check.length;i++)
        {
            var pattern = check[i];
            if (typeof pattern === "string")
            {
                var regexp = pattern.replace(/[*.?+\[\]^$]/g, regexpchanger);
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
    set: function(obj)
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
    load: function ()
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
    init: function()
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
