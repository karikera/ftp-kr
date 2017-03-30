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
const vscode = require("vscode");
const fs = require("./fs");
const window = vscode.window;
const workspace = vscode.workspace;
var output = null;
var statebar = null;
class Deferred {
    constructor() {
        this.promise = new Promise((res, rej) => {
            this.resolve = res;
            this.reject = rej;
        });
    }
    then(onfulfilled, onreject) {
        return this.promise.then(onfulfilled, onreject);
    }
    catch(func) {
        return this.promise.catch(func);
    }
}
exports.Deferred = Deferred;
function isEmptyObject(obj) {
    for (var p in obj)
        return false;
    return true;
}
exports.isEmptyObject = isEmptyObject;
function setState(state) {
    var bar;
    if (statebar)
        bar = statebar;
    else
        bar = statebar = window.createStatusBarItem();
    bar.text = state;
    bar.show();
}
exports.setState = setState;
function clearLog() {
    const out = output;
    if (!out)
        return;
    out.clear();
}
exports.clearLog = clearLog;
function showLog() {
    const out = output;
    if (!out)
        return;
    out.show();
}
exports.showLog = showLog;
function log(...message) {
    var out;
    if (output)
        out = output;
    else
        out = output = window.createOutputChannel("ftp-kr");
    out.appendLine(...message);
}
exports.log = log;
function wrap(func) {
    try {
        func();
    }
    catch (err) {
        error(err);
    }
}
exports.wrap = wrap;
function info(info, ...items) {
    return window.showInformationMessage(info, ...items);
}
exports.info = info;
function error(err) {
    console.error(err);
    log(err.toString());
    if (err instanceof Error) {
        window.showErrorMessage(err.message, 'Detail')
            .then(function (res) {
            if (res !== 'Detail')
                return;
            var output = '[';
            output += err.constructor.name;
            output += ']\nmessage: ';
            output += err.message;
            if (err.code) {
                output += '\ncode: ';
                output += err.code;
            }
            if (err.errno) {
                output += '\nerrno: ';
                output += err.errno;
            }
            output += '\n[Stack Trace]\n';
            output += err.stack;
            var LOGFILE = '/.vscode/ftp-kr.error.log';
            fs.create(LOGFILE, output)
                .then(() => open(LOGFILE))
                .catch(console.error);
        });
    }
    else {
        window.showErrorMessage(err.toString());
    }
}
exports.error = error;
function errorConfirm(err, ...items) {
    var message;
    if (err instanceof Error) {
        message = err.message;
        console.error(err);
        log(err.toString());
    }
    else {
        message = err;
        console.error(new Error(err));
        log(err);
    }
    return window.showErrorMessage(message, ...items);
}
exports.errorConfirm = errorConfirm;
function openWithError(path, message) {
    window.showErrorMessage(path + ": " + message);
    return open(path);
}
exports.openWithError = openWithError;
function select(list) {
    return window.showQuickPick(list);
}
exports.select = select;
function open(path) {
    return workspace.openTextDocument(fs.workspace + path)
        .then(doc => window.showTextDocument(doc));
}
exports.open = open;
function cascadingPromise(func, params) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (params.length == 0) {
                return Promise.resolve([]);
            }
            const response = [];
            for (const param of params) {
                const res = yield func(param);
                response.push(res);
            }
            return response;
        }
        catch (e) {
            throw e; // maybe unusable code?
        }
    });
}
exports.cascadingPromise = cascadingPromise;
function addOptions(args, options) {
    for (const key in options) {
        const value = options[key];
        if (Array.isArray(value)) {
            for (const val of value) {
                args.push("--" + key);
                args.push(val);
            }
            continue;
        }
        if (typeof value === 'boolean' && value === false) {
            continue;
        }
        args.push("--" + key);
        if (value !== true) {
            args.push(value);
        }
    }
}
exports.addOptions = addOptions;
function merge(original, overrider, access) {
    if (!overrider)
        return original;
    const conststr = [];
    const arrlist = [];
    var nex;
    if (!access) {
        nex = original;
    }
    else {
        nex = access;
        for (var p in original)
            access[p] = original[p];
    }
    function convert(value) {
        if (typeof value !== "string")
            return value;
        var nvalue = "";
        var i = 0;
        for (;;) {
            var j = value.indexOf("%", i);
            if (j === -1)
                break;
            var tx = value.substring(i, j);
            j++;
            var k = value.indexOf("%", j);
            if (k === -1)
                break;
            nvalue += tx;
            var varname = value.substring(j, k);
            if (varname in nex) {
                var val = nex[varname];
                if (val instanceof Array) {
                    if (val.length === 1) {
                        nvalue += val[0];
                    }
                    else {
                        conststr.push(nvalue);
                        nvalue = '';
                        arrlist.push(val);
                    }
                }
                else
                    nvalue += val;
            }
            else
                nvalue += "%" + varname + "%";
            i = k + 1;
        }
        nvalue += value.substr(i);
        if (arrlist.length !== 0) {
            conststr.push(nvalue);
            var from = [conststr];
            var to = [];
            for (var j = 0; j < arrlist.length; j++) {
                const list = arrlist[j];
                for (var i = 0; i < list.length; i++) {
                    for (var k = 0; k < from.length; k++) {
                        const cs = from[k];
                        const ncs = cs.slice(1, cs.length);
                        ncs[0] = cs[0] + list[i] + cs[1];
                        to.push(ncs);
                    }
                }
                var t = to;
                to = from;
                from = t;
                to.length = 0;
            }
            return from.map(v => v[0]);
        }
        return nvalue;
    }
    var out = {};
    for (var p in overrider) {
        var value = overrider[p];
        if (value instanceof Array) {
            const nvalue = [];
            for (let val of value) {
                val = convert(val);
                if (val instanceof Array)
                    nvalue.push(nvalue, ...val);
                else
                    nvalue.push(val);
            }
            out[p] = nvalue;
        }
        else if (value instanceof Object) {
            const ori = original[p];
            if (ori instanceof Object) {
                out[p] = merge(ori, value, nex[p]);
            }
            else {
                out[p] = value;
            }
        }
        else {
            out[p] = convert(value);
        }
    }
    for (const p in original) {
        if (p in out)
            continue;
        out[p] = original[p];
    }
    return out;
}
exports.merge = merge;
//# sourceMappingURL=util.js.map