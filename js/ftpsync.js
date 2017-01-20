
const config = require('./config');
const fs = require('./fs');
const ftp = require("./ftp");
const util = require('./util');
const f = require('./filesystem');
const stripJsonComments = require('strip-json-comments');

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

/** @type {number} */
f.State.prototype.lmtime = 0;
/** @type {boolean} */
f.State.prototype.ignoreWatcher = false;


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

class FtpFileSystem extends f.FileSystem
{
	constructor()
	{
		super();

		/** @type {!Object.<string, Deferred>} */
    	this.refreshed = {};
	}

	/**
	 * @param {!f.Directory} dir
	 * @param {string} path
	 * @private
	 */
	_deletedir(dir, path)
	{
		if (!this.refreshed[path]) return;
		delete this.refreshed[path];
		for(const filename in dir.files)
		{
			const childdir = dir.files[filename];
			if (!(childdir instanceof f.Directory)) continue;
			this._deletedir(childdir, path+'/'+filename);
		}
	}

	/**
	 * @param {string} path
	 */
	delete(path)
	{
		const dir = this.get(path);
		if (dir) this._deletedir(dir, path);
		super.delete(path);
	}
	
	/**
	 * @param {string} path
	 * @returns {!Promise}
	 */
	ftpDelete(path)
	{
		const that = this;
		function deleteTest(file)
		{
			var promise;
			if (file instanceof f.Directory) promise = ftp.rmdir(path);
			else promise = ftp.delete(path);
			return promise.then(() => that.delete(path))
		}
		function certainWork()
		{
			return that.ftpStat(path)
			.then((file) => {
				if (file === null) return;
				return deleteTest(file);
			});
		}

		const file = this.get(path);
		if (file === null) return certainWork();
		return deleteTest(file)
		.catch(certainWork);
	}

	/**
	 * @param {string} path
	 * @param {boolean} ignoreDirectory
	 * @return {!Promise.<State>}
	 */
	ftpUpload(path, ignoreDirectory)
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
	}

	/**
	 * @param {string} path
	 * @return {!Promise}
	 */
	ftpDownload(path)
	{
		function onfile(file)
		{
			if (!file)
			{
				util.error(`${path} not found in remote`);
				return Promise.resolve();
			}
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
	}

	/**
	 * @param {string} path
	 * @return {!Promise.<f.State>}
	 */
	ftpStat(path)
	{
		var fn = f.splitFileName(path);
		return this.ftpList(fn.dir)
		.then((dir) => dir.files[fn.name]);
	}
	/**
	 * @param {string} path
	 * @return {!Promise.<f.Directory>}
	 */
	ftpList(path)
	{
		const that = this;
		var latest = this.refreshed[path];
		if (latest) return latest.promise;
		const deferred = new util.Deferred;
		this.refreshed[path] = deferred;
		return ftp.list(path)
		.then(function(ftpfiles){
			const dir = that.refresh(path, ftpfiles);
			deferred.resolve(dir);
			return dir;
		})
		.catch(function(err){
			deferred.catch(() => {});
			deferred.reject(err);
			if (that.refreshed[path] === deferred) that.refreshed[path] = null;
			throw err;
		});
	}

	/**
	 * @param {string} path
	 * @return {!Promise.<Object.<string, string>>}
	 */
	syncTestUpload(path)
	{
		const output = {};
		const list = {};
		return _getUpdatedFile(this.root, path, list)
		.then(() => {
			let promise = Promise.resolve();
			for(const filepath in list)
			{
				const st = list[filepath];
				promise = promise
				.then(() => this.ftpStat(filepath))
				.then((file) => testLatest(file, st))
				.then((res) => { if(!res) output[filepath] = "upload"; });
			}
			return promise;
		})
		.then(() => output);
	}
		
	/**
	 * @param {string} path
	 * @param {!Object.<string, boolean>} list
	 * @param {boolean} download
	 */
	_listNotExists(path, list, download)
	{
		const that = this;
		const command = download ? "download" : "delete"; 
		return new Promise((resolve, reject)=>{
			var promise = Promise.resolve();
			function onfslist(fslist)
			{
				that.ftpList(path)
				.then((dir) => {
					const willDel = {};
					for(const p in dir.files)
					{
						switch(p)
						{
						case '': case '.': case '..': break;
						default:
							willDel[p] = true;
							if (dir.files[p] instanceof f.Directory)
							{
								promise = promise.then(() => that._listNotExists(path + "/" + p, list, download));
							}
							break;
						}
					}
					for(const file of fslist)
					{
						delete willDel[file];
					}
					for (const p in willDel)
					{
						if (download) list[path + "/" + p] = command;
						else promise = promise.then(() => list[path + "/" + p] = command);
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
	}

	/**
	 * @param {string} path
	 * @param {boolean} download
	 * @return {!Promise.<Object.<string, boolean>>}
	 */
	syncTestNotExists(path, download)
	{
		const list = {};
		return this._listNotExists(path, list, download)
		.then(() => list);
	}

	/**
	 * @param {string} path
	 */
	_refeshForce(path)
	{
		return this.ftpList(path)
		.then((dir) => {
			var promise = Promise.resolve();
			for(const p in dir.files)
			{
				switch(p)
				{
				case '': case '.': case '..': break;
				default:
					if (dir.files[p] instanceof f.Directory)
					{
						promise = promise.then(() => this._refeshForce(path + "/" + p));
					}
					break;
				}
			}
			return promise;
		}); 
	}
	
	ftpRefreshForce()
	{
		for(const p in this.refreshed)
		{
			delete this.refreshed[p];
		}
		return this._refeshForce('');
	}
}

const vfs = new FtpFileSystem;
var syncDataPath = "";

const sync = {
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
	 * @param {string} path
     * @returns {!Promise.<Object.<string, string>>}
     */
    syncTestUpload: function(path)
    {
        return vfs.syncTestUpload(path);
    },
    /**
	 * @param {string} path
     * @returns {!Promise.<Object.<string, string>>}
     */
    syncTestDownload: function(path)
    {
        return vfs.syncTestNotExists(path, true);
    },
    /**
     * @returns {void}
     */
    saveSync: function()
    {
        if(!syncDataPath) return;
        if (config.state !== 'LOADED') return;
        if (!config.createSyncCache) return;
        fs.mkdir("/.vscode");
        return fs.createSync(syncDataPath, JSON.stringify(vfs.serialize(), null, 4));
    },
    /**
     * @returns {!Promise}
     */
    load: function()
    {
        syncDataPath = `/.vscode/ftp-kr.sync.${config.protocol}.${config.host}.${config.remotePath.replace(/\//g, ".")}.json`;
        return fs.open(syncDataPath)
        .catch(()=>null)
        .then(function(data){
            try
            {
                if (data !== null) vfs.deserialize(JSON.parse(stripJsonComments(data)));
                else vfs.reset();
                vfs.refreshed = {};
            }
            catch(nerr)
            {
                util.error(nerr);
            }
        });
    },
    /**
     * @returns {!Promise}
     */
    refreshForce: function()
    {
		return vfs.ftpRefreshForce();
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