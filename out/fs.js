"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const stripJsonComments = require("strip-json-comments");
function callbackToPromise(call) {
    return new Promise((resolve, reject) => {
        call((err, data) => {
            if (err)
                reject(err);
            else
                resolve(data);
        });
    });
}
function mkdirParent(dirPath, callback) {
    return fs.mkdir(dirPath, error => {
        if (error) {
            switch (error.errno) {
                case 17:
                    callback();
                    return;
                case 34:
                    return mkdirParent(path.dirname(dirPath), () => fs.mkdir(dirPath, callback));
                case -4075:
                    callback();
                    return;
            }
        }
        callback && callback(error);
    });
}
;
exports.workspace = '';
function setWorkspace(path) {
    exports.workspace = path;
}
exports.setWorkspace = setWorkspace;
function worklize(localpath) {
    const fullpath = path.resolve(localpath).replace(/\\/g, '/');
    if (!fullpath.startsWith(exports.workspace))
        throw new Error(localpath + " not in workspace");
    const workpath = fullpath.substr(exports.workspace.length);
    if (workpath !== '' && workpath.charAt(0) !== '/')
        throw new Error(localpath + " not in workspace");
    return workpath;
}
exports.worklize = worklize;
function list(path) {
    if (path !== "" && !path.startsWith("/"))
        return Promise.reject(new Error("Path must starts with slash: " + path));
    return callbackToPromise((callback) => fs.readdir(exports.workspace + path, callback));
}
exports.list = list;
function stat(path) {
    if (path !== "" && !path.startsWith("/"))
        return Promise.reject(new Error("Path must starts with slash: " + path));
    return callbackToPromise((callback) => fs.stat(exports.workspace + path, callback));
}
exports.stat = stat;
function mkdir(path) {
    if (!path.startsWith("/"))
        return Promise.reject(new Error("Path must starts with slash: " + path));
    return new Promise((resolve, reject) => {
        fs.mkdir(exports.workspace + path, (err) => {
            if (err) {
                switch (err.errno) {
                    case 17: // EEXIST
                    case -4075:
                        resolve();
                        return;
                    default:
                        reject(err);
                        return;
                }
            }
            else
                resolve();
        });
    });
}
exports.mkdir = mkdir;
function mkdirp(path) {
    if (!path.startsWith("/"))
        return Promise.reject(new Error("Path must starts with slash: " + path));
    return callbackToPromise(callback => mkdirParent(exports.workspace + path, callback));
}
exports.mkdirp = mkdirp;
function lstat(path) {
    if (path !== "" && !path.startsWith("/"))
        return Promise.reject(new Error("Path must starts with slash: " + path));
    return callbackToPromise((callback) => fs.lstat(exports.workspace + path, callback));
}
exports.lstat = lstat;
function open(path) {
    if (!path.startsWith("/"))
        return Promise.reject(new Error("Path must starts with slash: " + path));
    return callbackToPromise((callback) => fs.readFile(exports.workspace + path, "utf-8", callback));
}
exports.open = open;
function exists(path) {
    if (!path.startsWith("/"))
        return Promise.reject(new Error("Path must starts with slash: " + path));
    return new Promise((resolve) => fs.exists(exports.workspace + path, resolve));
}
exports.exists = exists;
function json(path) {
    return open(path).then((data) => JSON.parse(stripJsonComments(data)));
}
exports.json = json;
function create(filepath, data) {
    return mkdirp(path.dirname(filepath))
        .then(() => callbackToPromise((callback) => fs.writeFile(exports.workspace + filepath, data, "utf-8", callback)));
}
exports.create = create;
function createSync(path, data) {
    if (!path.startsWith("/"))
        throw new Error("Path must starts with slash: " + path);
    return fs.writeFileSync(exports.workspace + path, data, "utf-8");
}
exports.createSync = createSync;
function unlink(path) {
    if (!path.startsWith("/"))
        return Promise.reject(new Error("Path must starts with slash: " + path));
    return callbackToPromise((callback) => fs.unlink(exports.workspace + path, callback));
}
exports.unlink = unlink;
function initJson(filepath, defaultValue) {
    return json(filepath).then((data) => {
        var changed = false;
        for (var p in defaultValue) {
            if (p in data)
                continue;
            data[p] = defaultValue[p];
            changed = true;
        }
        if (!changed)
            return data;
        return create(filepath, JSON.stringify(data, null, 4))
            .then(() => data);
    })
        .catch(() => {
        return create(filepath, JSON.stringify(defaultValue, null, 4))
            .then(() => Object.create(defaultValue));
    });
}
exports.initJson = initJson;
function isDirectory(path) {
    return stat(path).then(stat => stat.isDirectory());
}
exports.isDirectory = isDirectory;
//# sourceMappingURL=fs.js.map