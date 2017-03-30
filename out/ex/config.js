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
const config_1 = require("../config");
const work = require("../work");
const util = require("../util");
function makeEvent() {
    const list = [];
    const event = function event(onfunc) {
        list.push(onfunc);
    };
    event.fire = function () {
        return __awaiter(this, void 0, void 0, function* () {
            for (const func of list)
                yield func();
        });
    };
    event.rfire = function () {
        return __awaiter(this, void 0, void 0, function* () {
            for (var i = list.length - 1; i >= 0; i--)
                yield list[i]();
        });
    };
    return event;
}
function fireNotFound() {
    if (config_1.default.state === "NOTFOUND")
        return Promise.resolve();
    config_1.default.state = "NOTFOUND";
    return exports.onNotFound.rfire();
}
function fireInvalid() {
    if (config_1.default.state === "INVALID")
        return Promise.resolve();
    config_1.default.state = "INVALID";
    return exports.onInvalid.fire();
}
function fireLoad() {
    return exports.onLoad.fire()
        .then(function () {
        util.log("ftp-kr.json: loaded");
        config_1.default.state = "LOADED";
    })
        .catch(function (err) {
        util.error(err);
        util.open(config_1.default.PATH);
        return Promise.reject("INVALID");
    });
}
function onLoadError(err) {
    switch (err) {
        case "NOTFOUND":
            util.log("ftp-kr.json: not found");
            return fireNotFound();
        case "INVALID":
            util.log("ftp-kr.json: invalid");
            return fireInvalid();
        default:
            util.error(err);
            return;
    }
}
function loadTest() {
    if (config_1.default.state !== 'LOADED') {
        if (config_1.default.state === 'NOTFOUND')
            return Promise.reject('Config is not loaded');
        util.open(config_1.default.PATH);
        return Promise.reject(new Error("Need to fix"));
    }
    return Promise.resolve();
}
exports.loadTest = loadTest;
function isFtpDisabled() {
    if (config_1.default.disableFtp) {
        util.open(config_1.default.PATH);
        return Promise.reject(new Error("FTP is disabled. Please set disableFtp to false"));
    }
    return Promise.resolve();
}
exports.isFtpDisabled = isFtpDisabled;
function load() {
    return work.compile.add(() => work.ftp.add(() => work.load.add(() => config_1.default.load().then(fireLoad)).end()).end()).catch(onLoadError);
}
exports.load = load;
function unload() {
}
exports.unload = unload;
exports.onLoad = makeEvent();
exports.onInvalid = makeEvent();
exports.onNotFound = makeEvent();
exports.commands = {
    'ftpkr.init'() {
        return work.compile.add(() => work.ftp.add(() => work.load.add(() => config_1.default.init().then(fireLoad)).end()).end()).catch(onLoadError);
    }
};
//# sourceMappingURL=config.js.map