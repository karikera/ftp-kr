
var config = require('./config');
var fs = require('./fs');
var ftp = require("./ftp");
var util = require('./util');
var f = require('./filesystem');

/**
 * @param {fs.Stat} localStat
 * @param {State} file
 */
function testLatest(file, localStat)
{
    if (!file) return false;
    if (localStat.size !== file.size) return false;
    //if (+localStat.mtime > file.mtime) return false;
    switch(file.type)
    {
    case "-":
        if (!localStat.isFile()) return false;
        break;
    case "d":
        if (!localStat.isDirectory()) return false;
        break;
    case "l":
        if (!localStat.isSymbolicLink()) return false;
        break;
    }
    return true;
}


/**
 * @constructor
 * @extends {f.FileSystem}
 */
function FtpFileSystem()
{
    f.FileSystem.apply(this);
    this.refreshed = {};
}

/** @type {number} */
f.State.prototype.lmtime = 0;
/** @type {boolean} */
f.State.prototype.ignoreWatcher = false;

FtpFileSystem.prototype = Object.create(f.FileSystem.prototype);

/** @type {Object.<string, Deferred>} */
FtpFileSystem.prototype.refreshed = null;

/**
 * @param {string} path
 * @returns {!Promise}
 */
FtpFileSystem.prototype.ftpDelete = function(path)
{
    var that = this;
    function deleteTest(file)
    {
        var promise;
        if (file instanceof f.Directory) promise = ftp.rmdir(path);
        else promise = ftp.delete(path);
        return promise.then(() => vfs.delete(path))
    }
    function certainWork()
    {
        return that.ftpStat(path)
        .then((file) => {
            if (file === null) return;
            return deleteTest(file);
        });
    }

    var file = this.get(path);
    if (file === null) return certainWork();
    return deleteTest(file)
    .catch(certainWork);
    
};

/**
 * @param {string} path
 * @param {boolean} ignoreDirectory
 * @return {!Promise.<State>}
 */
FtpFileSystem.prototype.ftpUpload = function(path, ignoreDirectory)
{
    var that = this;
    return fs.stat(path)
    .then(function(stats){
        var oldfile = that.get(path);
        if (oldfile)
        {
            if(+stats.mtime === oldfile.lmtime) return oldfile;
            if (oldfile.ignoreWatcher)
            {
                oldfile.ignoreWatcher = false;
                if (config.autoUpload) return oldfile;
            }
        }

        if (stats.isDirectory())
        {
            if (ignoreDirectory) return null;

            var dir = oldfile;
            if (dir instanceof f.Directory)
            {
                dir.lmtime = +stats.mtime;
                return dir;
            }

            var promise;
            if (dir !== null)
                promise = that.ftpDelete(path).then(() => ftp.mkdir(path));
            else
                promise = ftp.mkdir(path);
            // catch(); , 디렉토리를 추적하며, 상태를 확인해야한다.
            return promise.then(() => {
                dir = that.mkdir(path, +stats.mtime);
                dir.lmtime = +stats.mtime;
                return dir;
            });
        }
        else
        {
            return ftp.upload(path, fs.workspace+ path)
            // catch(); , 디렉토리를 추적하며, 상태를 확인해야한다.
            .then(() => {
                var file = that.create(path, +stats.mtime);
                file.lmtime = +stats.mtime;
                file.size = stats.size;
                return file;
            });
        }
    });
};

/**
 * @param {string} path
 * @return {!Promise}
 */
FtpFileSystem.prototype.ftpDownload = function(path)
{
    function onfile(file)
    {
        if (!file) return fs.delete(path);
        var promise;
        if (config.autoUpload) file.ignoreWatcher = true;
        if (file instanceof f.Directory) promise = fs.mkdir(path);
        else promise = ftp.download(fs.workspace + path, path);
        return promise
        .then(() => fs.stat(path))
        .then((stats) => file.lmtime = +stats.mtime);
    }

    var file = this.get(path);
    if (file) return onfile(file);
    return this.ftpStat(path).then(onfile);
};

/**
 * @param {string} path
 * @return {!Promise.<f.State>}
 */
FtpFileSystem.prototype.ftpStat = function(path)
{
    var fn = f.splitFileName(path);
    return this.ftpList(fn.dir)
    .then((dir) => dir.files[fn.name]);
};
/**
 * @param {string} path
 * @return {!Promise.<f.Directory>}
 */
FtpFileSystem.prototype.ftpList = function(path)
{
    var that = this;
    var latest = this.refreshed[path];
    if (latest) return latest.promise;
    this.refreshed[path] = new util.Deferred;
    return ftp.list(path)
    .then(function(ftpfiles){
        var dir = that.refresh(path, ftpfiles);
        that.refreshed[path].resolve(dir);
        return dir;
    })
    .catch(function(err){
        var prom = that.refreshed[path];
        prom.catch(() => {});
        prom.reject(err);
        that.refreshed[path] = null;
        throw err;
    });
};

/**
 * @param {Directory} cmp
 * @param {string} path
 * @param {!Object.<string, fs.Stat>} list
 * @returns {!Promise}
 */
function _getUpdatedFileInDir(cmp, path, list)
{
    function addFile(filename)
    {
        var filepath = path + "/" + filename;
        var file = cmp ? cmp.files[filename] : null;
        promise = promise
        .then(() => _getUpdatedFile(file, filepath, list));
    }
    var promise = Promise.resolve();
    return fs.list(path)
    .then(function(files){
        for(var i=0;i<files.length;i++) addFile(files[i]);
        return promise;
    });
}

/**
 * @param {State} cmp
 * @param {string} path
 * @param {!Object.<string, fs.Stat>} list
 * @returns {!Promise}
 */
function _getUpdatedFile(cmp, path, list)
{    
    if (config.checkIgnorePath(path)) return;
    return fs.lstat(path)
    .then(function(st){
        if (st.isDirectory()) return _getUpdatedFileInDir(cmp, path, list);
        if (testLatest(cmp, st)) return;
        list[path] = st;
    })
    .catch(() => {});
}

/**
 * @param {string} path
 * @return {!Promise.<Object.<string, string>>}
 */
FtpFileSystem.prototype.syncTestUpload = function(path)
{
    var output = {};
    var list = {};
    return _getUpdatedFile(this.root, path, list)
    .then(() => {
        function addWork(filepath, st)
        {
            promise = promise
            .then(() => vfs.ftpStat(filepath))
            .then((file) => testLatest(file, st))
            .then((res) => { if(!res) output[filepath] = "upload"; });
        }

        var promise = Promise.resolve();
        for(var filepath in list) addWork(filepath, list[filepath]);
        return promise;
    })
    .then(() => output);
};

/**
 * @param {string} path
 * @param {!Object.<string, boolean>} list
 * @param {boolean} download
 */
function _listNotExists(path, list, download)
{
    var command = download ? "download" : "delete"; 
    var promise = new Promise(function(resolve, reject){
        var promise = Promise.resolve();
        function next(npath)
        {
            promise = promise.then(() => _listNotExists(npath, list, download));
        }
        function onfslist(fslist)
        {
            vfs.ftpList(path)
            .then((dir) => {
                var willDel = {};
                for(var p in dir.files) willDel[p] = true;
                delete willDel[""];
                delete willDel["."];
                delete willDel[".."];
                for(var file of fslist)
                {
                    delete willDel[file];
                }
                for (let p in willDel)
                {
                    if (download) list[path + "/" + p] = command;
                    if (dir.files[p] instanceof f.Directory) next(path + "/" + p);
                    if (!download) promise = promise.then(() => list[path + "/" + p] = command);
                }
                resolve(promise);
            })
            .catch((err) => reject(err))
        }
        fs.list(path)
        .then(onfslist)
        .catch(() => {
            if (!download) resolve();
            else onfslist([]);
        });
    }); 
    return promise;
}

/**
 * @param {string} path
 * @param {boolean} download
 * @return {!Promise.<Object.<string, boolean>>}
 */
FtpFileSystem.prototype.syncTestNotExists = function(path, download)
{
    var list = {};
    return _listNotExists(path, list, download)
    .then(() => list);
};

var vfs = new FtpFileSystem;
var syncDataPath = "";


var sync = {
    /**
     * @param {Object.<string, string>} task
     * @returns {!Promise}
     */
    exec: function(task)
    {
        var errorCount = 0;
        var failedTasks = {};
        function addWork(file, exec)
        {
            switch (exec)
            {
            case 'upload': promise = promise.then(() => vfs.ftpUpload(file)); break;
            case 'download': promise = promise.then(() => vfs.ftpDownload(file)); break;
            case 'delete': promise = promise.then(() => vfs.ftpDelete(file)); break;
            }
            promise = promise.catch((err) => {
                failedTasks[file] = exec;
                console.error(err);
                util.log(err);
                errorCount ++;
            });
        }
        var promise = Promise.resolve();
        for (var file in task) addWork(file, task[file]);
        return promise.then(() => {
            if (errorCount) return {tasks:failedTasks, count:errorCount};
        });
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    delete: function(path)
    {
        return vfs.ftpDelete(path);
    },
    /**
     * @param {string} path
     * @param {boolean=} ignoreDirectory
     * @returns {!Promise}
     */
    upload: function(path, ignoreDirectory)
    {
        return vfs.ftpUpload(path, ignoreDirectory);
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    download: function(path)
    {
        return vfs.ftpDownload(path);
    },
    /**
     * @returns {!Promise.<Object.<string, string>>}
     */
    syncTestClean: function()
    {
        return vfs.syncTestNotExists("", false);
    },
    /**
     * @returns {!Promise.<Object.<string, string>>}
     */
    syncTestUpload: function()
    {
        return vfs.syncTestUpload("");
    },
    /**
     * @returns {!Promise.<Object.<string, string>>}
     */
    syncTestDownload: function()
    {
        return vfs.syncTestNotExists("", true);
    },
    /**
     * @returns {void}
     */
    saveSync: function()
    {
        if(!syncDataPath) return;
        fs.mkdir("/.vscode");
        return fs.createSync(syncDataPath, JSON.stringify(vfs.serialize(), null, 4));
    },
    /**
     * @returns {!Promise}
     */
    load: function()
    {
        if (!syncDataPath)
        {
            syncDataPath = "/.vscode/ftp-kr.sync."+config.host+"."+config.remotePath.replace(/\//g, ".")+".json";
        }
        return fs.open(syncDataPath)
        .catch(()=>null)
        .then(function(data){
            try
            {
                if (data !== null) vfs.deserialize(JSON.parse(data));
                else vfs.reset();
                vfs.refreshed = {};
                config.loaded = true;
            }
            catch(nerr)
            {
                util.error(nerr);
            }
        });
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    refresh: function(path)
    {
        return vfs.ftpList(path);
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    delete:function(path)
    {
        return vfs.ftpDelete(path);
    },
};

module.exports = sync;