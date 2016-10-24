
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
    //Call the standard fs.mkdir
    return fs.mkdir(dirPath, function (error) 
    {
        //When it fail in this way, do the custom steps
        if (error && error.errno === 34) 
        {
            //Create all the parents recursively
            return mkdirParent(path.dirname(dirPath), () => fs.mkdir(dirPath, callback));
        }
        //Manually run the callback since we used our own callback to do all these
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
        return fullpath.substr(nfs.workspace.length);        
    },

    /**
     * @param {string} path
     * @returns {!Promise.<Array.<string>>}
     */
    list: function(path)
    {
        return callbackToPromise((callback)=>fs.readdir(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise.<FSStat>}
     */
    stat: function(path)
    {
        return callbackToPromise((callback)=>fs.stat(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    mkdir: function(path)
    {
        return callbackToPromise((callback)=>fs.mkdir(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    mkdirp: function(path)
    {
        return callbackToPromise((callback)=>mkdirParent(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise.<FSStat>}
     */
    lstat: function(path)
    {
        return callbackToPromise((callback)=>fs.lstat(nfs.workspace + path, callback));
    },
    /**
     * @param {string} path
     * @returns {!Promise.<string>}
     */
    open: function(path)
    {
        return callbackToPromise((callback)=>fs.readFile(nfs.workspace + path, "utf-8", callback));
    },

    /**
     * @param {string} path
     * @returns {!Promise.<boolean>}
     */
    exists: function(path)
    {
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
     * @param {string} path
     * @param {string} data
     * @returns {Promise}
     */
    create: function(path, data)
    {
        return callbackToPromise((callback)=>fs.writeFile(nfs.workspace + path, data, "utf-8", callback));
    },

    /**
     * @param {string} path
     * @param {string} data
     * @returns {void}
     */
    createSync: function(path, data)
    {
        return fs.writeFileSync(nfs.workspace + path, data, "utf-8");
    },

    /**
     * @param {string} path
     * @returns {Promise}
     */
    delete: function(path)
    {
        return callbackToPromise((callback)=>fs.unlink(nfs.workspace + path, callback));
    },

    /**
     * @param {string} path
     * @returns {Promise}
     */
    initJson: function(dirpath, defaultValue)
    {
        return nfs.json(dirpath).then(function(data){
            var changed = false;
            for (var p in defaultValue)
            {
                if (p in data) continue;
                data[p] = defaultValue[p];
                changed = true;
            }
            if (!changed) return;
            return nfs.create(dirpath, JSON.stringify(data, null, 4))
            .then(()=> data);
        })
        .catch(function(){
            nfs.mkdir(".vscode");
            nfs.create(dirpath, JSON.stringify(defaultValue, null, 4));
            return Object.create(defaultValue);
        });
    }
};
