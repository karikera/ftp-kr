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
const fs = require("./fs");
const util = require("./util");
const stripJsonComments = require("strip-json-comments");
const CONFIG_PATH = "/.vscode/ftp-kr.json";
const CONFIG_BASE = {
    host: "",
    username: "",
    password: "",
    remotePath: "",
    protocol: "ftp",
    port: 0,
    fileNameEncoding: "utf8",
    ignoreWrongFileEncoding: false,
    createSyncCache: true,
    autoUpload: true,
    autoDelete: false,
    autoDownload: false,
    disableFtp: false,
    ignore: [
        "/.git",
        "/.vscode/chrome",
        "/.vscode/.key",
        "/.vscode/ftp-kr.task.json",
        "/.vscode/ftp-kr.error.log",
        "/.vscode/ftp-kr.sync.*.json"
    ],
    closure: {
        create_source_map: "%js_output_file%.map",
        output_wrapper: "%output%\n//# sourceMappingURL=%js_output_file_filename%.map",
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
function regexpchanger(chr) {
    return REGEXP_MAP[chr];
}
function setConfig(newobj) {
    for (const p in newobj) {
        const v = newobj[p];
        exports.config[p] = (v instanceof Object) ? Object.create(v) : v;
    }
}
class ConfigNamespace {
    constructor() {
        this.PATH = CONFIG_PATH;
        this.state = 'NOTFOUND';
        this.initTimeForVSBug = 0;
        this.closure = {};
    }
    checkIgnorePath(path) {
        if (!path.startsWith("/"))
            path = "/" + path;
        const check = exports.config.ignore;
        for (var i = 0; i < check.length; i++) {
            let pattern = check[i];
            if (typeof pattern === "string") {
                let regexp = pattern.replace(/[*.?+\[\]^$]/g, regexpchanger);
                if (regexp.startsWith("/"))
                    regexp = "^" + regexp;
                else
                    regexp = ".*/" + regexp;
                if (!regexp.endsWith("/"))
                    regexp += "(/.*)?$";
                pattern = check[i] = new RegExp(regexp);
            }
            if (pattern.test(path))
                return true;
        }
        return false;
    }
    set(obj) {
        if (!(obj instanceof Object)) {
            throw new TypeError("Invalid json data type: " + typeof obj);
        }
        if (!obj.disableFtp) {
            if (!obj.host) {
                throw new Error("Need host");
            }
            if (!obj.username) {
                throw new Error("Need username");
            }
        }
        setConfig(obj);
        if (!exports.config.remotePath)
            exports.config.remotePath = '/';
        else if (exports.config.remotePath.endsWith("/"))
            exports.config.remotePath = exports.config.remotePath.substr(0, exports.config.remotePath.length - 1);
        switch (exports.config.protocol) {
            case 'ftps':
            case 'sftp':
            case 'ftp': break;
            default:
                util.error(`Unsupported protocol "${exports.config.protocol}", It will treat as ftp`);
                exports.config.protocol = 'ftp';
                break;
        }
    }
    load() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                var data = yield fs.open(CONFIG_PATH);
            }
            catch (err) {
                throw "NOTFOUND";
            }
            try {
                exports.config.set(JSON.parse(stripJsonComments(data)));
            }
            catch (err) {
                util.error(err);
                util.open(CONFIG_PATH);
                throw "INVALID";
            }
        });
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                exports.config.initTimeForVSBug = Date.now();
                const data = yield fs.initJson(CONFIG_PATH, CONFIG_BASE);
                exports.config.set(data);
                util.open(CONFIG_PATH);
            }
            catch (err) {
                util.error(err);
                throw 'INVALID';
            }
        });
    }
}
exports.config = new ConfigNamespace;
exports.default = exports.config;
setConfig(CONFIG_BASE);
//# sourceMappingURL=config.js.map