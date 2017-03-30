"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const fs = require("./fs");
const ftp = require("./ftp");
const util = require("./util");
const f = require("./filesystem");
const stripJsonComments = require("strip-json-comments");
function testLatest(file, localStat) {
    if (!file)
        return false;
    if (file instanceof f.FileCommon) {
        if (localStat.size !== file.size)
            return false;
    }
    switch (file.type) {
        case "-":
            if (!localStat.isFile())
                return false;
            break;
        case "d":
            if (!localStat.isDirectory())
                return false;
            break;
        case "l":
            if (!localStat.isSymbolicLink())
                return false;
            break;
    }
    return true;
}
function _getUpdatedFileInDir(cmp, path, list) {
    return __awaiter(this, void 0, void 0, function* () {
        const files = yield fs.list(path);
        for (const filename of files) {
            var filepath = path + "/" + filename;
            var childfile = null;
            if (cmp) {
                const file = cmp.files[filename];
                if (file)
                    childfile = file;
            }
            _getUpdatedFile(childfile, filepath, list);
        }
    });
}
function _getUpdatedFile(cmp, path, list) {
    return __awaiter(this, void 0, void 0, function* () {
        if (config_1.default.checkIgnorePath(path))
            return;
        try {
            const st = yield fs.lstat(path);
            if (st.isDirectory())
                yield _getUpdatedFileInDir(cmp instanceof f.Directory ? cmp : null, path, list);
            if (testLatest(cmp, st))
                return;
            list[path] = st;
        }
        catch (err) {
        }
    });
}
class RefreshedData extends util.Deferred {
    constructor() {
        super();
        this.accessTime = new Date().valueOf();
    }
}
class FtpFileSystem extends f.FileSystem {
    constructor() {
        super(...arguments);
        this.refreshed = new Map;
    }
    _deletedir(dir, path) {
        if (!this.refreshed.delete(path))
            return;
        for (const filename in dir.files) {
            const childdir = dir.files[filename];
            if (!(childdir instanceof f.Directory))
                continue;
            this._deletedir(childdir, path + '/' + filename);
        }
    }
    delete(path) {
        const dir = this.get(path);
        if (dir)
            this._deletedir(dir, path);
        super.delete(path);
    }
    ftpDelete(path) {
        return __awaiter(this, void 0, void 0, function* () {
            const that = this;
            function deleteTest(file) {
                return __awaiter(this, void 0, void 0, function* () {
                    if (file instanceof f.Directory)
                        yield ftp.rmdir(path);
                    else
                        yield ftp.remove(path);
                    that.delete(path);
                });
            }
            var file = this.get(path);
            if (file !== null) {
                try {
                    return yield deleteTest(file);
                }
                catch (err) {
                }
            }
            file = yield that.ftpStat(path);
            if (file === null)
                return;
            yield deleteTest(file);
        });
    }
    ftpUpload(path, weak) {
        return __awaiter(this, void 0, void 0, function* () {
            const stats = yield fs.stat(path);
            const that = this;
            function next(stats) {
                return __awaiter(this, void 0, void 0, function* () {
                    if (stats.isDirectory()) {
                        if (weak)
                            return null;
                        if (oldfile !== null) {
                            if (oldfile instanceof f.Directory) {
                                oldfile.lmtime = +stats.mtime;
                                return oldfile;
                            }
                            yield that.ftpDelete(path).then(() => ftp.mkdir(path));
                        }
                        else {
                            yield ftp.mkdir(path);
                        }
                        const dir = that.mkdir(path);
                        dir.lmtime = +stats.mtime;
                        return dir;
                    }
                    else {
                        that.refreshed.delete(path);
                        const fn = f.splitFileName(path);
                        that.refreshed.delete(fn.dir);
                        yield ftp.upload(path, fs.workspace + path);
                        const file = that.create(path);
                        file.lmtime = +stats.mtime;
                        file.size = stats.size;
                        return file;
                    }
                });
            }
            const oldfile = this.get(path);
            if (!oldfile)
                return yield next(stats);
            if (weak) {
                if (Date.now() < oldfile.ignoreUploadTime) {
                    oldfile.ignoreUploadTime = 0;
                    return oldfile;
                }
            }
            if (+stats.mtime === oldfile.lmtime)
                return oldfile;
            if (!config_1.default.autoDownload)
                return yield next(stats);
            const oldsize = oldfile.size;
            const ftpstats = yield this.ftpStat(path);
            if (ftpstats instanceof f.FileCommon && oldsize === ftpstats.size)
                return yield next(stats);
            const selected = yield util.errorConfirm(`${path}: Remote file modified detected.`, "Upload anyway", "Download");
            if (!selected)
                return oldfile;
            if (selected !== "Download")
                return yield next(stats);
            this.ftpDownload(path);
            return oldfile;
        });
    }
    ftpDownload(path) {
        return __awaiter(this, void 0, void 0, function* () {
            var file = this.get(path);
            if (!file) {
                file = yield this.ftpStat(path);
                if (!file) {
                    util.error(`${path} not found in remote`);
                    return Promise.resolve();
                }
            }
            if (file instanceof f.Directory)
                yield fs.mkdir(path);
            else
                yield ftp.download(fs.workspace + path, path);
            const stats = yield fs.stat(path);
            file.lmtime = +stats.mtime;
            file.ignoreUploadTime = Date.now() + 1000;
        });
    }
    ftpDownloadWithCheck(path) {
        return __awaiter(this, void 0, void 0, function* () {
            const file = yield this.ftpStat(path);
            if (!file) {
                if (config_1.default.autoUpload) {
                    yield this.ftpUpload(path);
                }
                return;
            }
            var stats = yield fs.stat(path);
            if (file instanceof f.FileCommon && stats.size === file.size)
                return;
            if (file instanceof f.Directory)
                yield fs.mkdir(path);
            else
                yield ftp.download(fs.workspace + path, path);
            stats = yield fs.stat(path);
            file.lmtime = +stats.mtime;
            file.ignoreUploadTime = Date.now() + 1000;
        });
    }
    ftpStat(path) {
        return __awaiter(this, void 0, void 0, function* () {
            const fn = f.splitFileName(path);
            const dir = yield this.ftpList(fn.dir);
            return dir.files[fn.name];
        });
    }
    ftpList(path) {
        const latest = this.refreshed.get(path);
        if (latest) {
            const refreshTime = config_1.default.autoDownloadRefreshTime ? config_1.default.autoDownloadRefreshTime : 1000;
            if (latest.accessTime + refreshTime > Date.now())
                return latest.promise;
        }
        const deferred = new RefreshedData;
        this.refreshed.set(path, deferred);
        return ftp.list(path)
            .then(ftpfiles => {
            const dir = this.refresh(path, ftpfiles);
            deferred.resolve(dir);
            return dir;
        })
            .catch(err => {
            deferred.catch(() => { });
            deferred.reject(err);
            if (this.refreshed.get(path) === deferred) {
                this.refreshed.delete(path);
            }
            throw err;
        });
    }
    syncTestUpload(path) {
        const output = {};
        const list = {};
        return _getUpdatedFile(this.root, path, list)
            .then(() => {
            let promise = Promise.resolve();
            for (const filepath in list) {
                const st = list[filepath];
                promise = promise
                    .then(() => this.ftpStat(filepath))
                    .then((file) => testLatest(file, st))
                    .then((res) => { if (!res)
                    output[filepath] = "upload"; });
            }
            return promise;
        })
            .then(() => output);
    }
    _listNotExists(path, list, download) {
        return __awaiter(this, void 0, void 0, function* () {
            if (config_1.default.checkIgnorePath(path))
                return;
            const that = this;
            const command = download ? "download" : "delete";
            var fslist;
            try {
                fslist = yield fs.list(path);
            }
            catch (err) {
                if (!download)
                    return;
                fslist = [];
            }
            try {
                const dir = yield that.ftpList(path);
                const willDel = {};
                const dirlist = [];
                for (const p in dir.files) {
                    const fullPath = path + "/" + p;
                    if (config_1.default.checkIgnorePath(fullPath))
                        continue;
                    switch (p) {
                        case '':
                        case '.':
                        case '..': break;
                        default:
                            willDel[p] = true;
                            if (dir.files[p] instanceof f.Directory) {
                                dirlist.push(fullPath);
                            }
                            break;
                    }
                }
                for (const file of fslist) {
                    delete willDel[file];
                }
                function flushList() {
                    for (const p in willDel) {
                        list[path + "/" + p] = command;
                    }
                }
                function processChild() {
                    return __awaiter(this, void 0, void 0, function* () {
                        for (const child of dirlist) {
                            yield that._listNotExists(child, list, download);
                        }
                    });
                }
                if (download) {
                    flushList();
                    yield processChild();
                }
                else {
                    yield processChild();
                    flushList();
                }
            }
            catch (err) {
                throw err;
            }
        });
    }
    syncTestNotExists(path, download) {
        const list = {};
        return this._listNotExists(path, list, download)
            .then(() => list);
    }
    _refeshForce(path) {
        return __awaiter(this, void 0, void 0, function* () {
            const dir = yield this.ftpList(path);
            for (const p in dir.files) {
                switch (p) {
                    case '':
                    case '.':
                    case '..': break;
                    default:
                        if (dir.files[p] instanceof f.Directory) {
                            yield this._refeshForce(path + "/" + p);
                        }
                        break;
                }
            }
        });
    }
    ftpRefreshForce() {
        this.refreshed.clear();
        return this._refeshForce('');
    }
}
const vfs = new FtpFileSystem;
var syncDataPath = "";
function exec(task) {
    return __awaiter(this, void 0, void 0, function* () {
        var errorCount = 0;
        const failedTasks = {};
        for (const file in task) {
            const exec = task[file];
            try {
                switch (exec) {
                    case 'upload':
                        yield vfs.ftpUpload(file);
                        break;
                    case 'download':
                        yield vfs.ftpDownload(file);
                        break;
                    case 'delete':
                        yield vfs.ftpDelete(file);
                        break;
                }
            }
            catch (err) {
                failedTasks[file] = exec;
                console.error(err);
                util.log(err);
                errorCount++;
            }
        }
        if (errorCount)
            return { tasks: failedTasks, count: errorCount };
        else
            return null;
    });
}
exports.exec = exec;
function upload(path, weak) {
    return vfs.ftpUpload(path, weak);
}
exports.upload = upload;
function download(path) {
    return vfs.ftpDownload(path);
}
exports.download = download;
function downloadWithCheck(path) {
    return vfs.ftpDownloadWithCheck(path);
}
exports.downloadWithCheck = downloadWithCheck;
function syncTestClean() {
    return vfs.syncTestNotExists("", false);
}
exports.syncTestClean = syncTestClean;
function syncTestUpload(path) {
    return vfs.syncTestUpload(path);
}
exports.syncTestUpload = syncTestUpload;
function syncTestDownload(path) {
    return vfs.syncTestNotExists(path, true);
}
exports.syncTestDownload = syncTestDownload;
function saveSync() {
    if (!syncDataPath)
        return;
    if (config_1.default.state !== 'LOADED')
        return;
    if (!config_1.default.createSyncCache)
        return;
    fs.mkdir("/.vscode");
    return fs.createSync(syncDataPath, JSON.stringify(vfs.serialize(), null, 4));
}
exports.saveSync = saveSync;
function load() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            syncDataPath = `/.vscode/ftp-kr.sync.${config_1.default.protocol}.${config_1.default.host}.${config_1.default.remotePath.replace(/\//g, ".")}.json`;
            try {
                var data = yield fs.open(syncDataPath);
                var obj = JSON.parse(stripJsonComments(data));
                if (obj.version === 1) {
                    vfs.deserialize(obj);
                }
            }
            catch (err) {
                vfs.reset();
            }
            vfs.refreshed.clear();
        }
        catch (nerr) {
            util.error(nerr);
        }
    });
}
exports.load = load;
function refreshForce() {
    return vfs.ftpRefreshForce();
}
exports.refreshForce = refreshForce;
function list(path) {
    return __awaiter(this, void 0, void 0, function* () {
        const NAMES = {
            'd': '[DIR] ',
            '-': '[FILE]',
        };
        var selected = yield util.select(vfs.ftpList(path).then(dir => {
            const list = [];
            for (const filename in dir.files) {
                switch (filename) {
                    case '':
                    case '.': continue;
                    case '..': if (path === '')
                        continue;
                }
                const file = dir.files[filename];
                list.push(NAMES[file.type] + '\t' + filename);
            }
            list.sort();
            return list;
        }));
        if (selected === undefined)
            return;
        const typecut = selected.indexOf('\t');
        const type = selected.substr(0, typecut);
        selected = selected.substr(typecut + 1);
        if (selected === '..') {
            return yield list(path.substring(0, path.lastIndexOf('/')));
        }
        const npath = path + '/' + selected;
        switch (type) {
            case NAMES['d']: return yield list(npath);
            case NAMES['-']:
                const act = yield util.select(['Download ' + selected, 'Upload ' + selected, 'Delete ' + selected]);
                if (act === undefined)
                    return yield list(path);
                const cmd = act.substr(0, act.indexOf(' '));
                switch (cmd) {
                    case 'Download':
                        yield download(npath);
                        break;
                    case 'Upload':
                        yield upload(npath);
                        break;
                    case 'Delete':
                        yield remove(npath);
                        break;
                }
        }
    });
}
exports.list = list;
function refresh(path) {
    return vfs.ftpList(path);
}
exports.refresh = refresh;
function remove(path) {
    return vfs.ftpDelete(path);
}
exports.remove = remove;
//# sourceMappingURL=ftpsync.js.map