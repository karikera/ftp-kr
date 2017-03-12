
const config = require('./config');
const fs = require('./fs');
const ftp = require('./ftp');
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

class RefreshedData extends util.Deferred
{
	constructor()
	{
		super();
		/** @type {number} */
		this.accessTime = new Date().valueOf();
	}
}

class FtpFileSystem extends f.FileSystem
{
	constructor()
	{
		super();

		/** @type {!Map.<string, !RefreshedData>} */
    	this.refreshed = new Map;
	}

	/**
	 * @param {!f.Directory} dir
	 * @param {string} path
	 * @private
	 */
	_deletedir(dir, path)
	{
		if (!this.refreshed.delete(path)) return;
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
	 * @param {boolean} weak
	 * @return {!Promise.<State>}
	 */
	ftpUpload(path, weak)
	{
		return fs.stat(path).then(stats=>{
			const that = this;
			function next(stats)
			{
				if (stats.isDirectory())
				{
					if (weak) return null;

					var promise;
					if (oldfile !== null)
					{
						if (oldfile instanceof f.Directory)
						{
							oldfile.lmtime = +stats.mtime;
							return oldfile;
						}
						promise = that.ftpDelete(path).then(() => ftp.mkdir(path));
					}
					else
						promise = ftp.mkdir(path);

					var dir = oldfile;
					return promise.then(() => {
						dir = that.mkdir(path, +stats.mtime);
						dir.lmtime = +stats.mtime;
						return dir;
					});
				}
				else
				{
					that.refreshed.delete(path);
					const fn = f.splitFileName(path);
					that.refreshed.delete(fn.dir);
					return ftp.upload(path, fs.workspace+ path)
					.then(() => {
						const file = that.create(path);
						file.lmtime = +stats.mtime;
						file.size = stats.size;
						return file;
					});
				}
			}
			
			const oldfile = this.get(path);
			if (!oldfile) return next(stats);
			if (weak)
			{
				if (+new Date() < oldfile.ignoreUploadTime)
				{
					oldfile.ignoreUploadTime = 0;
					return oldfile;
				}
			}
			if (+stats.mtime === oldfile.lmtime) return oldfile;
			if (!config.autoDownload) return next(stats);

			const oldsize = oldfile.size;
			return this.ftpStat(path).then(ftpstats=>{
				if (oldsize === ftpstats.size) return next(stats);
				return util.errorConfirm(`${path}: Remote file modified detected.`, "Upload anyway", "Download")
				.then(selected=>{
					if (!selected) return oldfile;
					if (selected !== "Download") return next(stats);
					this.ftpDownload(path);
					return oldfile;
				});
			});
		});
	}

	/**
	 * @param {string} path
	 * @return {!Promise}
	 */
	ftpDownload(path)
	{
		/**
		 * @param {f.State} file
		 */
		function onfile(file)
		{
			if (!file)
			{
				util.error(`${path} not found in remote`);
				return Promise.resolve();
			}
			var promise;
			if (file instanceof f.Directory) promise = fs.mkdir(path);
			else promise = ftp.download(fs.workspace + path, path);
			return promise.then(() => fs.stat(path))
			.then(stats => {
				file.lmtime = +stats.mtime;
				file.ignoreUploadTime = +new Date() + 1000;
			});
		}
		const oldfile = this.get(path);
		if (oldfile) return onfile(oldfile);
		return this.ftpStat(path).then(onfile);
	}

	/**
	 * @param {string} path
	 * @return {!Promise}
	 */
	ftpDownloadWithCheck(path)
	{
		const that = this;
		/**
		 * @param {f.State} file
		 */
		function onfile(file)
		{
			if (!file)
			{
				if (config.autoUpload)
				{
					return that.ftpUpload(path);
				}
				return;
			}

			return fs.stat(path)
			.then(stats=>{
				if (stats.size === file.size) return;
				var promise;
				if (file instanceof f.Directory) promise = fs.mkdir(path);
				else promise = ftp.download(fs.workspace + path, path);
				return promise.then(() => fs.stat(path))
				.then(stats => {
					file.lmtime = +stats.mtime;
					file.ignoreUploadTime = +new Date() + 1000;
				});
			})
		}
		return this.ftpStat(path).then(onfile);
	}

	/**
	 * @param {string} path
	 * @return {!Promise<f.State>}
	 */
	ftpStat(path)
	{
		const fn = f.splitFileName(path);
		return this.ftpList(fn.dir)
		.then(dir => dir.files[fn.name]);
	}

	/**
	 * @param {string} path
	 * @return {!Promise.<f.Directory>}
	 */
	ftpList(path)
	{
		const latest = this.refreshed.get(path);
		if (latest)
		{
			if (latest.accessTime + config.autoDownloadRefreshTime > +new Date())
			return latest.promise;
		}
		const deferred = new RefreshedData;
		this.refreshed.set(path, deferred);
		return ftp.list(path)
		.then(ftpfiles=>{
			const dir = this.refresh(path, ftpfiles);
			deferred.resolve(dir);
			return dir;
		})
		.catch(err=>{
			deferred.catch(() => {});
			deferred.reject(err);
			if (this.refreshed.get(path) === deferred)
			{
				this.refreshed.delete(path);
			}
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
        if (config.checkIgnorePath(path)) return;
		const that = this;
		const command = download ? "download" : "delete"; 
		return new Promise((resolve, reject)=>{
			var promise = Promise.resolve();
			function onfslist(fslist)
			{
				that.ftpList(path).then(dir => {
					const willDel = {};
					for(const p in dir.files)
					{
						const fullPath = path + "/" + p;
        				if (config.checkIgnorePath(fullPath)) continue;

						switch(p)
						{
						case '': case '.': case '..': break;
						default:
							willDel[p] = true;
							if (dir.files[p] instanceof f.Directory)
							{
								promise = promise.then(() => that._listNotExists(fullPath, list, download));
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
		this.refreshed.clear();
		return this._refeshForce('');
	}
}

const vfs = new FtpFileSystem;
var syncDataPath = "";

const sync = {
    /**
     * @param {Object.<string, string>} task
     * @returns {!Promise<?{tasks:Object, number}>}
     */
    exec(task)
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
    delete(path)
    {
        return vfs.ftpDelete(path);
    },
    /**
     * @param {string} path
     * @param {boolean=} weak
     * @returns {!Promise}
     */
    upload(path, weak)
    {
        return vfs.ftpUpload(path, weak);
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    download(path)
    {
        return vfs.ftpDownload(path);
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    downloadWithCheck(path)
    {
        return vfs.ftpDownloadWithCheck(path);
    },
    /**
     * @returns {!Promise.<Object.<string, string>>}
     */
    syncTestClean()
    {
        return vfs.syncTestNotExists("", false);
    },
    /**
	 * @param {string} path
     * @returns {!Promise.<Object.<string, string>>}
     */
    syncTestUpload(path)
    {
        return vfs.syncTestUpload(path);
    },
    /**
	 * @param {string} path
     * @returns {!Promise.<Object.<string, string>>}
     */
    syncTestDownload(path)
    {
        return vfs.syncTestNotExists(path, true);
    },
    /**
     * @returns {void}
     */
    saveSync()
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
    load()
    {
        syncDataPath = `/.vscode/ftp-kr.sync.${config.protocol}.${config.host}.${config.remotePath.replace(/\//g, ".")}.json`;
        return fs.open(syncDataPath)
        .catch(()=>null)
        .then(data=>{
            try
            {
                if (data !== null)
				{
					data = JSON.parse(stripJsonComments(data));
					if (data.version === 1)
					{
						vfs.deserialize(data);
					}
				}
                else vfs.reset();
                vfs.refreshed.clear();
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
    refreshForce()
    {
		return vfs.ftpRefreshForce();
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
	list(path)
	{
		const NAMES = {
			'd': '[DIR] ',
			'-': '[FILE]',
		};
		return util.select(vfs.ftpList(path).then(dir=>{
			const list = [];
			for(const filename in dir.files)
			{
				switch(filename)
				{
				case '': case '.': continue;
				case '..': if(path === '') continue;
				}
				const file = dir.files[filename];
				list.push(NAMES[file.type]+'\t'+filename);
			}
			list.sort();
			return list;
		}))
		.then(selected=>{
			if (selected === undefined) return;
			const typecut = selected.indexOf('\t');
			const type = selected.substr(0, typecut);
			selected = selected.substr(typecut+1);
			if (selected === '..')
			{
				return sync.list(path.substring(0, path.lastIndexOf('/')));
			}
			const npath = path + '/' + selected;
			switch (type)
			{
			case NAMES['d']:
				return sync.list(npath);
			case NAMES['-']:
				return util.select(['Download '+selected,'Upload '+selected,'Delete '+selected])
				.then(selected=>{
					if (selected === undefined) return sync.list(path);
					const cmd = selected.substr(0, selected.indexOf(' '));
					switch(cmd)
					{
					case 'Download': return sync.download(npath);
					case 'Upload': return sync.upload(npath);
					case 'Delete': return sync.delete(npath);
					}
				});
			}
		});
	},
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    refresh(path)
    {
        return vfs.ftpList(path);
    },
    /**
     * @param {string} path
     * @returns {!Promise}
     */
    delete(path)
    {
        return vfs.ftpDelete(path);
    },
};

module.exports = sync;