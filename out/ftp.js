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
const FtpClient = require("ftp");
const SftpClient = require("ssh2-sftp-client");
const config_1 = require("./config");
const util = require("./util");
const ofs = require("fs");
const fs = require("./fs");
const iconv = require("iconv-lite");
const path = require("path");
const DIRECTORY_NOT_FOUND = 1;
const FILE_NOT_FOUND = 2;
const ALREADY_DESTROYED = 'destroyed connection access';
var client = null;
var connectionInfo = '';
function makeConnectionInfo() {
    const usepk = config_1.default.protocol === 'sftp' && !!config_1.default.privateKey;
    var info = config_1.default.protocol;
    info += '://';
    info += config_1.default.username;
    if (config_1.default.password && !usepk) {
        info += ':';
        info += config_1.default.password;
    }
    info += '@';
    info += config_1.default.host;
    if (config_1.default.port) {
        info += ':';
        info += config_1.default.port;
    }
    info += '/';
    info += config_1.default.remotePath;
    info += '/';
    if (usepk) {
        info += '#';
        info += config_1.default.privateKey;
        if (config_1.default.passphrase !== undefined) {
            info += '#';
            info += config_1.default.passphrase;
        }
    }
    return info;
}
function bin2str(bin) {
    var buf = iconv.encode(bin, 'binary');
    return iconv.decode(buf, config_1.default.fileNameEncoding);
}
function str2bin(str) {
    var buf = iconv.encode(str, config_1.default.fileNameEncoding);
    return iconv.decode(buf, 'binary');
}
function toftpPath(workpath) {
    return str2bin(config_1.default.remotePath + workpath);
}
class FileInfo {
    constructor() {
        this.type = '';
        this.name = '';
        this.size = 0;
        this.date = 0;
    }
}
class FileInterface {
    constructor() {
        this.destroyTimeout = null;
        client = this;
    }
    cancelDestroyTimeout() {
        if (!this.destroyTimeout)
            return;
        clearTimeout(this.destroyTimeout);
        this.destroyTimeout = null;
    }
    update() {
        this.cancelDestroyTimeout();
        this.destroyTimeout = setTimeout(this.destroy.bind(this), config_1.default.connectionTimeout ? config_1.default.connectionTimeout : 60000);
    }
    destroy() {
        util.log('Disconnected');
        this.cancelDestroyTimeout();
        client = null;
    }
    _callWithName(name, workpath, ignorecode, callback) {
        this.cancelDestroyTimeout();
        util.setState(name + " " + workpath);
        util.log(name + ": " + workpath);
        const ftppath = toftpPath(workpath);
        return callback(ftppath).then(v => {
            util.setState("");
            this.update();
            return v;
        })
            .catch((err) => {
            util.setState("");
            this.update();
            if (err.ftpCode === ignorecode)
                return;
            util.log(name + " fail: " + workpath);
            throw _errorWrap(err);
        });
    }
    upload(workpath, localpath) {
        this.cancelDestroyTimeout();
        util.setState("upload " + workpath);
        util.log("upload: " + workpath);
        const ftppath = toftpPath(workpath);
        return this._put(localpath, ftppath)
            .catch(err => {
            if (err.ftpCode !== DIRECTORY_NOT_FOUND)
                throw err;
            const ftpdir = ftppath.substr(0, ftppath.lastIndexOf("/") + 1);
            if (!ftpdir)
                throw err;
            return this._mkdir(ftpdir, true)
                .then(() => this._put(localpath, ftppath));
        })
            .then(() => {
            util.setState("");
            this.update();
        })
            .catch((err) => {
            util.setState("");
            this.update();
            util.log("upload fail: " + workpath);
            throw _errorWrap(err);
        });
    }
    download(localpath, workpath) {
        this.cancelDestroyTimeout();
        util.setState("download " + workpath);
        util.log("download: " + workpath);
        const ftppath = toftpPath(workpath);
        return this._get(ftppath)
            .then((stream) => {
            return new Promise(resolve => {
                stream.once('close', () => {
                    util.setState("");
                    this.update();
                    resolve();
                });
                stream.pipe(ofs.createWriteStream(localpath));
            });
        })
            .catch(err => {
            util.setState("");
            this.update();
            util.log("download fail: " + workpath);
            throw _errorWrap(err);
        });
    }
    list(workpath) {
        this.cancelDestroyTimeout();
        util.setState("list " + workpath);
        util.log("list: " + workpath);
        var ftppath = toftpPath(workpath);
        if (!ftppath)
            ftppath = ".";
        return this._list(ftppath).then((list) => {
            util.setState("");
            this.update();
            const errfiles = [];
            for (var i = 0; i < list.length; i++) {
                const file = list[i];
                const fn = file.name = bin2str(file.name);
                if (!config_1.default.ignoreWrongFileEncoding) {
                    if (fn.indexOf('�') !== -1 || fn.indexOf('?') !== -1)
                        errfiles.push(fn);
                }
            }
            if (errfiles.length) {
                util.errorConfirm("Invalid encoding detected. Please set fileNameEncoding correctly\n" + errfiles.join('\n'), 'Open config', 'Ignore after')
                    .then(function (res) {
                    switch (res) {
                        case 'Open config':
                            util.open(config_1.default.PATH);
                            break;
                        case 'Ignore after':
                            config_1.default.ignoreWrongFileEncoding = true;
                            break;
                    }
                });
            }
            return list;
        })
            .catch(err => {
            util.setState("");
            this.update();
            util.log("list fail: " + workpath);
            throw _errorWrap(err);
        });
    }
    rmdir(workpath) {
        return this._callWithName("rmdir", workpath, FILE_NOT_FOUND, ftppath => this._rmdir(ftppath, true));
    }
    delete(workpath) {
        return this._callWithName("delete", workpath, FILE_NOT_FOUND, ftppath => this._delete(ftppath));
    }
    mkdir(workpath) {
        return this._callWithName("mkdir", workpath, 0, ftppath => this._mkdir(ftppath, true));
    }
    lastmod(workpath) {
        return this._callWithName("lastmod", workpath, 0, ftppath => this._lastmod(ftppath));
    }
    _lastmod(ftppath) {
        return Promise.reject('NOTSUPPORTED');
    }
}
class Ftp extends FileInterface {
    constructor() {
        super();
        this.client = new FtpClient();
    }
    connect() {
        client = this;
        return new Promise((resolve, reject) => {
            if (!this.client)
                return Promise.reject(Error(ALREADY_DESTROYED));
            this.client.on("ready", () => {
                if (!this.client)
                    return Promise.reject(Error(ALREADY_DESTROYED));
                const socket = this.client['_socket'];
                const oldwrite = socket.write;
                socket.write = str => {
                    return oldwrite.call(socket, str, 'binary');
                };
                this.update();
                resolve();
            });
            this.client.on("error", e => {
                reject(e);
                if (this.client) {
                    this.client.end();
                    this.client = null;
                }
                client = null;
            });
            var options;
            if (config_1.default.protocol === 'ftps') {
                options = {
                    secure: true,
                    secureOptions: {
                        rejectUnauthorized: false,
                    }
                };
            }
            else {
                options = {};
            }
            options.host = config_1.default.host;
            options.port = config_1.default.port ? config_1.default.port : 21;
            options.user = config_1.default.username;
            options.password = config_1.default.password;
            /// 
            options = util.merge(options, config_1.default.ftpOverride);
            this.client.connect(options);
        });
    }
    destroy() {
        super.destroy();
        if (this.client) {
            this.client.end();
            this.client = null;
        }
    }
    static wrapToPromise(callback) {
        return new Promise((resolve, reject) => callback((err, val) => {
            if (err)
                reject(err);
            else
                resolve(val);
        }));
    }
    _rmdir(ftppath, recursive) {
        const client = this.client;
        if (!client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return Ftp.wrapToPromise(callback => client.rmdir(ftppath, recursive, callback))
            .catch(e => {
            if (e.code === 550)
                e.ftpCode = FILE_NOT_FOUND;
            throw e;
        });
    }
    _mkdir(ftppath, recursive) {
        const client = this.client;
        if (!client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return Ftp.wrapToPromise(callback => client.mkdir(ftppath, recursive, callback));
    }
    _delete(ftppath) {
        const client = this.client;
        if (!client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return Ftp.wrapToPromise(callback => client.delete(ftppath, callback))
            .catch(e => {
            if (e.code === 550)
                e.ftpCode = FILE_NOT_FOUND;
            throw e;
        });
    }
    _put(localpath, ftppath) {
        const client = this.client;
        if (!client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return Ftp.wrapToPromise(callback => client.put(localpath, ftppath, callback))
            .catch(e => {
            if (e.code === 553)
                e.ftpCode = DIRECTORY_NOT_FOUND;
            throw e;
        });
    }
    _get(ftppath) {
        const client = this.client;
        if (!client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return Ftp.wrapToPromise(callback => client.get(ftppath, callback));
    }
    _list(ftppath) {
        const client = this.client;
        if (!client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return Ftp.wrapToPromise(callback => client.list('-al ' + ftppath, false, callback))
            .then(list => list.map(from => {
            const to = new FileInfo;
            to.type = from.type;
            to.name = from.name;
            to.date = +from.date;
            to.size = +from.size;
            return to;
        }));
    }
    _lastmod(ftppath) {
        const client = this.client;
        if (!client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return Ftp.wrapToPromise(callback => client.lastMod(ftppath, callback))
            .then(date => +date);
    }
}
class Sftp extends FileInterface {
    constructor() {
        super();
        this.client = new SftpClient;
    }
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!this.client)
                    return Promise.reject(Error(ALREADY_DESTROYED));
                var options;
                if (config_1.default.privateKey) {
                    var keyPath = config_1.default.privateKey;
                    const keybuf = yield new Promise((resolve, reject) => {
                        if (!path.isAbsolute(keyPath)) {
                            keyPath = path.join(fs.workspace, '.vscode', keyPath);
                        }
                        ofs.readFile(keyPath, 'utf-8', (err, data) => {
                            if (err)
                                reject(err);
                            else
                                resolve(data);
                        });
                    });
                    options = {
                        privateKey: keybuf,
                        passphrase: config_1.default.passphrase
                    };
                }
                else {
                    options = {
                        password: config_1.default.password,
                    };
                }
                options.host = config_1.default.host;
                options.port = config_1.default.port ? config_1.default.port : 22,
                    options.username = config_1.default.username;
                // options.hostVerifier = (keyHash:string) => false;
                options = util.merge(options, config_1.default.sftpOverride);
                yield this.client.connect(options);
                this.update();
            }
            catch (err) {
                if (this.client) {
                    this.client.end();
                    this.client = null;
                }
                client = null;
                throw err;
            }
        });
    }
    destroy() {
        super.destroy();
        if (this.client) {
            this.client.end();
            this.client = null;
        }
    }
    _rmdir(ftppath) {
        if (!this.client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return this.client["rmdir"](ftppath, true)
            .catch(e => {
            if (e.code === 2)
                e.ftpCode = FILE_NOT_FOUND;
            throw e;
        });
    }
    _delete(ftppath) {
        if (!this.client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return this.client.delete(ftppath)
            .catch(e => {
            if (e.code === 2)
                e.ftpCode = FILE_NOT_FOUND;
            throw e;
        });
    }
    _mkdir(ftppath) {
        if (!this.client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return this.client.mkdir(ftppath, true);
    }
    _put(localpath, ftppath) {
        if (!this.client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return this.client.put(localpath, ftppath)
            .catch(e => {
            if (e.code === 2)
                e.ftpCode = DIRECTORY_NOT_FOUND;
            throw e;
        });
    }
    _get(ftppath) {
        if (!this.client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return this.client.get(ftppath);
    }
    _list(ftppath) {
        if (!this.client)
            return Promise.reject(Error(ALREADY_DESTROYED));
        return this.client.list(ftppath)
            .then(list => list.map(from => {
            const to = new FileInfo;
            to.type = from.type;
            to.name = from.name;
            to.date = from.modifyTime;
            to.size = +from.size;
            return to;
        })).catch(e => {
            if (e.code === 2)
                return [];
            else
                throw e;
        });
    }
    lastmod(ftppath) {
        return Promise.reject('NOTSUPPORTED');
    }
}
function init() {
    const coninfo = makeConnectionInfo();
    if (client) {
        if (coninfo === connectionInfo) {
            client.update();
            return Promise.resolve(client);
        }
        client.destroy();
    }
    connectionInfo = coninfo;
    var newclient;
    switch (config_1.default.protocol) {
        case 'sftp':
            newclient = new Sftp;
            break;
        case 'ftp':
            newclient = new Ftp;
            break;
        case 'ftps':
            newclient = new Ftp;
            break;
        default: throw Error(`Invalid protocol ${config_1.default.protocol}`);
    }
    var url = '';
    url += config_1.default.protocol;
    url += '://';
    url += config_1.default.host;
    if (config_1.default.port) {
        url += ':';
        url += config_1.default.port;
    }
    url += config_1.default.remotePath;
    url += '/';
    util.log(`Try connect to ${url} with user ${config_1.default.username}`);
    return newclient.connect().then(() => {
        util.log('Connected');
        return newclient;
    });
}
function _errorWrap(err) {
    return new Error(err.message + "[" + err.code + "]");
}
function rmdir(workpath) {
    return init().then(client => client.rmdir(workpath));
}
exports.rmdir = rmdir;
function remove(workpath) {
    return init().then(client => client.delete(workpath));
}
exports.remove = remove;
function mkdir(workpath) {
    return init().then(client => client.mkdir(workpath));
}
exports.mkdir = mkdir;
function upload(workpath, localpath) {
    return init().then(client => client.upload(workpath, localpath));
}
exports.upload = upload;
function download(localpath, workpath) {
    return init().then(client => client.download(localpath, workpath));
}
exports.download = download;
function list(workpath) {
    return init().then(client => client.list(workpath));
}
exports.list = list;
//# sourceMappingURL=ftp.js.map