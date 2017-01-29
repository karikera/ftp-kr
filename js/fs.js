
const fs = require("fs");
const path = require('path');
const stripJsonComments = require('strip-json-comments');

class FSStat
{
	constructor()
	{
		/** @type{number} */
		this.dev = 0;
		/** @type{number} */
		this.ino = 0;
		/** @type{number} */
		this.mode = 0;
		/** @type{number} */
		this.nlink = 0;
		/** @type{number} */
		this.uid = 0;
		/** @type{number} */
		this.gid = 0;
		/** @type{number} */
		this.rdev = 0;
		/** @type{number} */
		this.size = 0;
		/** @type{number} */
		this.blksize = 0;
		/** @type{number} */
		this.blocks = 0;
		/** @type{Date} */
		this.atime = null;
		/** @type{Date} */
		this.mtime = null;
		/** @type{Date} */
		this.ctime = null;
		/** @type{Date} */
		this.birthtime = null;
	}

	/**
	 * @returns {boolean}
	 */
	isFile() {};
	/**
	 * @returns {boolean}
	 */
	isDirectory() {};
	/**
	 * @returns {boolean}
	 */
	isBlockDevice() {};
	/**
	 * @returns {boolean}
	 */
	isCharacterDevice() {};
	/**
	 * @returns {boolean}
	 */
	isSymbolicLink() {};
	/**
	 * @returns {boolean}
	 */
	isFIFO() {};
	/**
	 * @returns {boolean}
	 */
	isSocket() {};
}

/**
 * @template T
 * @param {function(function(Error, T))} call
 * @returns {!Promise.<T>}
 */
function callbackToPromise(call)
{
    return new Promise(function(resolve, reject){
        call(function(err, data){
            if (err) reject(err);
            else resolve(data);
        });
    });
}
function mkdirParent(dirPath, callback) 
{
    return fs.mkdir(dirPath, function (error) 
    {
        if (error)
        {
            switch(error.errno)
            {
            case 34:
                return mkdirParent(path.dirname(dirPath), () => fs.mkdir(dirPath, callback));
            case -4075:
                callback();
                return;
            }
        }
        callback && callback(error);
    });
};

const nfs = module.exports = {

    Stat: FSStat,

    workspace: "",

    /**
     * @param {string} localpath
     * @returns {string}
     */
    worklize(localpath)
    {
        const fullpath = path.resolve(localpath).replace(/\\/g, '/');
        if (!fullpath.startsWith(nfs.workspace))
            throw new Error(localpath+" not in workspace");
        const workpath = fullpath.substr(nfs.workspace.length);
        if (workpath !== '' && workpath.charAt(0) !== '/')
            throw new Error(localpath+" not in workspace");
        return workpath;
    },

    /**
     * @param {string} path
     * @returns {!Promise.<Array.<string>>}
     */
    list(path)
    {
        if (path !== "" && !path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
        return callbackToPromise((callback)=>fs.readdir(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise.<FSStat>}
     */
    stat(path)
    {
        if (path !== "" && !path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
        return callbackToPromise((callback)=>fs.stat(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    mkdir(path)
    {
        if (!path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
        return new Promise(function(resolve, reject){
            fs.mkdir(nfs.workspace + path, function(err){
                if (err)
                {
                    if (err.errno === -4075) resolve();
                    else reject(err);
                }
                else resolve();
            });
        });
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    mkdirp(path)
    {
        if (!path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
        return callbackToPromise((callback)=>mkdirParent(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise.<FSStat>}
     */
    lstat(path)
    {
        if (path !== "" && !path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
        return callbackToPromise((callback)=>fs.lstat(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise.<string>}
     */
    open(path)
    {
        if (!path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
        return callbackToPromise((callback)=>fs.readFile(nfs.workspace + path, "utf-8", callback));
    },

    /**
     * @param {string} path
     * @returns {!Promise.<boolean>}
     */
    exists(path)
    {
        if (!path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
        return new Promise((resolve) => fs.exists(nfs.workspace + path, resolve));
    },

    /**
     * @param {string} path
     * @returns {Promise.<*>}
     */
    json(path)
    {
        return nfs.open(path).then((data) => JSON.parse(stripJsonComments(data)));
    },

    /**
     * @param {string} filepath
     * @param {string} data
     * @returns {Promise}
     */
    create(filepath, data)
    {
        return nfs.mkdirp(path.dirname(filepath))
        .then(() => callbackToPromise((callback)=>fs.writeFile(nfs.workspace + filepath, data, "utf-8", callback)));
    },

    /**
     * @param {string} path
     * @param {string} data
     * @returns {void}
     */
    createSync(path, data)
    {
        if (!path.startsWith("/")) throw new Error("Path must starts with slash: "+path);
        return fs.writeFileSync(nfs.workspace + path, data, "utf-8");
    },

    /**
     * @param {string} path
     * @returns {Promise}
     */
    delete(path)
    {
        if (!path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
        return callbackToPromise((callback)=>fs.unlink(nfs.workspace + path, callback));
    },

    /**
     * @param {string} filepath
     * @returns {Promise}
     */
    initJson(filepath, defaultValue)
    {
        return nfs.json(filepath).then(function(data){
            var changed = false;
            for (var p in defaultValue)
            {
                if (p in data) continue;
                data[p] = defaultValue[p];
                changed = true;
            }
            if (!changed) return data;
            return nfs.create(filepath, JSON.stringify(data, null, 4))
            .then(()=> data);
        })
        .catch(function(){
            return nfs.create(filepath, JSON.stringify(defaultValue, null, 4))
            .then(() => Object.create(defaultValue));
        });
    },

	/**
	 * @param {string} path
	 * @return {!Promise<boolean>}
	 */
	isDirectory(path)
	{
		return nfs.stat(path).then(stat=>stat.isDirectory());
	}
};
