
var fs = require("fs");
var path = require('path');

/**
 * @constructor
 */
function FSStat()
{
}

/** @type{number} */
FSStat.prototype.dev = 0;
/** @type{number} */
FSStat.prototype.ino = 0;
/** @type{number} */
FSStat.prototype.mode = 0;
/** @type{number} */
FSStat.prototype.nlink = 0;
/** @type{number} */
FSStat.prototype.uid = 0;
/** @type{number} */
FSStat.prototype.gid = 0;
/** @type{number} */
FSStat.prototype.rdev = 0;
/** @type{number} */
FSStat.prototype.size = 0;
/** @type{number} */
FSStat.prototype.blksize = 0;
/** @type{number} */
FSStat.prototype.blocks = 0;
/** @type{Date} */
FSStat.prototype.atime = null;
/** @type{Date} */
FSStat.prototype.mtime = null;
/** @type{Date} */
FSStat.prototype.ctime = null;
/** @type{Date} */
FSStat.prototype.birthtime = null;

/**
 * @returns {boolean}
 */
FSStat.prototype.isFile = function () {};
/**
 * @returns {boolean}
 */
FSStat.prototype.isDirectory = function () {};
/**
 * @returns {boolean}
 */
FSStat.prototype.isBlockDevice = function () {};
/**
 * @returns {boolean}
 */
FSStat.prototype.isCharacterDevice = function () {};
/**
 * @returns {boolean}
 */
FSStat.prototype.isSymbolicLink = function () {};
/**
 * @returns {boolean}
 */
FSStat.prototype.isFIFO = function () {};
/**
 * @returns {boolean}
 */
FSStat.prototype.isSocket = function () {};

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
                break;
            }
        }
        callback && callback(error);
    });
};

var nfs = module.exports = {

    Stat: FSStat,

    workspace: "",

    /**
     * @param {string} localpath
     * @returns {string}
     */
    worklize: function(localpath)
    {
        var fullpath = path.resolve(localpath).replace(/\\/g, '/');
        if (!fullpath.startsWith(nfs.workspace))
            throw new Error(localpath+" not in workspace");
        var workpath = fullpath.substr(nfs.workspace.length);
        if (!workpath.startsWith("/"))
            throw new Error(localpath+" not in workspace");
        return fullpath.substr(nfs.workspace.length);        
    },

    /**
     * @param {string} path
     * @returns {!Promise.<Array.<string>>}
     */
    list: function(path)
    {
        if (path !== "" && !path.startsWith("/")) return Promise.reject(new Error("Wield workspace path "+path));
        return callbackToPromise((callback)=>fs.readdir(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise.<FSStat>}
     */
    stat: function(path)
    {
        if (path !== "" && !path.startsWith("/")) return Promise.reject(new Error("Wield workspace path "+path));
        return callbackToPromise((callback)=>fs.stat(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    mkdir: function(path)
    {
        if (!path.startsWith("/")) return Promise.reject(new Error("Wield workspace path "+path));
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
    mkdirp: function(path)
    {
        if (!path.startsWith("/")) return Promise.reject(new Error("Wield workspace path "+path));
        return callbackToPromise((callback)=>mkdirParent(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise.<FSStat>}
     */
    lstat: function(path)
    {
        if (path !== "" && !path.startsWith("/")) return Promise.reject(new Error("Wield workspace path "+path));
        return callbackToPromise((callback)=>fs.lstat(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise.<string>}
     */
    open: function(path)
    {
        if (!path.startsWith("/")) return Promise.reject(new Error("Wield workspace path "+path));
        return callbackToPromise((callback)=>fs.readFile(nfs.workspace + path, "utf-8", callback));
    },

    /**
     * @param {string} path
     * @returns {!Promise.<boolean>}
     */
    exists: function(path)
    {
        if (!path.startsWith("/")) return Promise.reject(new Error("Wield workspace path "+path));
        return new Promise((resolve) => fs.exists(nfs.workspace + path, resolve));
    },

    /**
     * @param {string} path
     * @returns {Promise.<*>}
     */
    json: function(path)
    {
        return nfs.open(path).then((data) => JSON.parse(data));
    },

    /**
     * @param {string} filepath
     * @param {string} data
     * @returns {Promise}
     */
    create: function(filepath, data)
    {
        return nfs.mkdirp(path.dirname(filepath))
        .then(() => callbackToPromise((callback)=>fs.writeFile(nfs.workspace + filepath, data, "utf-8", callback)));
    },

    /**
     * @param {string} path
     * @param {string} data
     * @returns {void}
     */
    createSync: function(path, data)
    {
        if (!path.startsWith("/")) throw new Error("Wield workspace path "+path);
        return fs.writeFileSync(nfs.workspace + path, data, "utf-8");
    },

    /**
     * @param {string} path
     * @returns {Promise}
     */
    delete: function(path)
    {
        if (!path.startsWith("/")) return Promise.reject(new Error("Wield workspace path "+path));
        return callbackToPromise((callback)=>fs.unlink(nfs.workspace + path, callback));
    },

    /**
     * @param {string} filepath
     * @returns {Promise}
     */
    initJson: function(filepath, defaultValue)
    {
        return nfs.json(filepath).then(function(data){
            var changed = false;
            for (var p in defaultValue)
            {
                if (p in data) continue;
                data[p] = defaultValue[p];
                changed = true;
            }
            if (!changed) return;
            return nfs.create(filepath, JSON.stringify(data, null, 4))
            .then(()=> data);
        })
        .catch(function(){
            return nfs.create(filepath, JSON.stringify(defaultValue, null, 4))
            .then(() => Object.create(defaultValue));
        });
    }
};
