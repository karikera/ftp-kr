"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const workspace = vscode.workspace;
const window = vscode.window;
const config_1 = require("../config");
const fs = require("../fs");
const ftpsync = require("../ftpsync");
const work = require("../work");
const util = require("../util");
const cfg = require("./config");
var watcher = null;
var openWatcher = null;
var watcherMode = "";
var openWatcherMode = false;
var initTime = 0;
const TASK_FILE_PATH = "/.vscode/ftp-kr.task.json";
cfg.onLoad(function () {
    if (config_1.default.disableFtp) {
        attachOpenWatcher(false);
        attachWatcher("CONFIG");
        return;
    }
    return ftpsync.load()
        .then(() => ftpsync.refresh(""))
        .then(() => {
        attachWatcher(config_1.default.autoUpload || config_1.default.autoDelete ? "FULL" : "CONFIG");
        attachOpenWatcher(!!config_1.default.autoDownload);
    });
});
cfg.onInvalid(() => {
    attachOpenWatcher(false);
    attachWatcher("CONFIG");
});
cfg.onNotFound(() => {
    attachOpenWatcher(false);
    attachWatcher("");
});
function processWatcher(path, upload, autoSync) {
    function commit() {
        if (!autoSync)
            return;
        if (config_1.default.checkIgnorePath(path))
            return;
        work.ftp.add(() => upload(path)).catch(util.error);
    }
    try {
        if (path == config_1.default.PATH) {
            // #2. 와처가 바로 이전에 생성한 설정 파일에 반응하는 상황을 우회
            if (config_1.default.initTimeForVSBug) {
                const inittime = config_1.default.initTimeForVSBug;
                config_1.default.initTimeForVSBug = 0;
                if (upload === ftpsync.upload) {
                    if (Date.now() <= inittime + 500) {
                        util.open(config_1.default.PATH);
                        return;
                    }
                }
            }
            util.showLog();
            let promise = cfg.load();
            if (watcherMode !== 'CONFIG')
                promise = promise.then(() => commit());
            promise.catch(util.error);
        }
        else
            commit();
    }
    catch (err) {
        util.error(err);
    }
}
function attachOpenWatcher(mode) {
    if (openWatcherMode === mode)
        return;
    openWatcherMode = mode;
    if (mode) {
        openWatcher = workspace.onDidOpenTextDocument(e => {
            const workpath = fs.worklize(e.fileName);
            try {
                if (!config_1.default.autoDownload)
                    return;
                if (config_1.default.checkIgnorePath(workpath))
                    return;
                work.ftp.add(() => ftpsync.downloadWithCheck(workpath)).catch(util.error);
            }
            catch (err) {
                util.error(err);
            }
        });
    }
    else {
        if (openWatcher) {
            openWatcher.dispose();
            openWatcher = null;
        }
    }
}
function attachWatcher(mode) {
    if (watcherMode === mode)
        return;
    if (watcher)
        watcher.dispose();
    watcherMode = mode;
    var watcherPath = fs.workspace;
    switch (watcherMode) {
        case "FULL":
            watcherPath += "/**/*";
            break;
        case "CONFIG":
            watcherPath += config_1.default.PATH;
            break;
        case "":
            watcher = null;
            return;
    }
    watcher = workspace.createFileSystemWatcher(watcherPath);
    // #1. 부모 디렉토리가 삭제된 다음 자식 디렉토리가 갱신되는 상황을 우회
    var deleteParent = ""; // #1
    watcher.onDidChange(e => {
        const path = fs.worklize(e.fsPath);
        if (deleteParent && path.startsWith(deleteParent + "/"))
            return; // #1
        processWatcher(path, path => ftpsync.upload(path, true), !!config_1.default.autoUpload);
    });
    watcher.onDidCreate(e => {
        const path = fs.worklize(e.fsPath);
        if (deleteParent && deleteParent === path)
            deleteParent = ""; // #1
        processWatcher(path, ftpsync.upload, !!config_1.default.autoUpload);
    });
    watcher.onDidDelete(e => {
        const path = fs.worklize(e.fsPath);
        deleteParent = path; // #1
        processWatcher(path, ftpsync.remove, !!config_1.default.autoDelete);
    });
}
function reserveSyncTaskWith(tasks, taskname, infocallback) {
    if (util.isEmptyObject(tasks)) {
        util.info("Nothing to DO");
        return Promise.resolve();
    }
    util.showLog();
    util.log(taskname + ' started');
    return fs.create(TASK_FILE_PATH, JSON.stringify(tasks, null, 1))
        .then(() => util.open(TASK_FILE_PATH))
        .then(infocallback)
        .then((res) => {
        if (res !== "OK" && res !== "Retry") {
            fs.unlink(TASK_FILE_PATH);
            return;
        }
        const startTime = Date.now();
        return fs.json(TASK_FILE_PATH)
            .then((data) => fs.unlink(TASK_FILE_PATH).then(() => ftpsync.exec(data)))
            .then((failed) => {
            if (!failed) {
                const passedTime = Date.now() - startTime;
                if (passedTime > 1000) {
                    util.info(taskname + " completed");
                }
                util.showLog();
                util.log(taskname + ' completed');
                return;
            }
            return reserveSyncTaskWith(failed.tasks, taskname, () => util.errorConfirm("ftp-kr Task failed, more information in the output", "Retry"));
        });
    })
        .catch(function (err) {
        fs.unlink(TASK_FILE_PATH).catch(() => { });
        throw err;
    });
}
function taskTimer(taskname, taskpromise) {
    const startTime = Date.now();
    return taskpromise.then(() => {
        const passedTime = Date.now() - startTime;
        if (passedTime > 1000) {
            util.info(taskname + " completed");
        }
    });
}
function reserveSyncTask(tasks, taskname) {
    return reserveSyncTaskWith(tasks, taskname, () => util.info("This will be occurred. Are you OK?", "OK"));
}
function fileOrEditorFile(file) {
    try {
        if (file) {
            const path = fs.worklize(file.fsPath);
            return Promise.resolve(path);
        }
        else {
            const editor = window.activeTextEditor;
            if (!editor)
                throw new Error("No file opened");
            const doc = editor.document;
            const path = fs.worklize(doc.fileName);
            return doc.save().then(() => path);
        }
    }
    catch (err) {
        return Promise.reject(err);
    }
}
function uploadAll(path) {
    return ftpsync.syncTestUpload(path)
        .then((tasks) => reserveSyncTask(tasks, 'Upload All'));
}
function downloadAll(path) {
    return ftpsync.syncTestDownload(path)
        .then((tasks) => reserveSyncTask(tasks, 'Download All'));
}
module.exports = {
    load() {
    },
    unload() {
        ftpsync.saveSync();
    },
    commands: {
        'ftpkr.upload'(file) {
            return cfg.loadTest()
                .then(() => cfg.isFtpDisabled())
                .then(() => fileOrEditorFile(file))
                .then((path) => work.ftp.add(() => fs.isDirectory(path)
                .then(isdir => isdir ? uploadAll(path) : taskTimer('Upload', ftpsync.upload(path).then(() => { })))).catch(util.error)).catch(util.error);
        },
        'ftpkr.download'(file) {
            return cfg.loadTest()
                .then(() => cfg.isFtpDisabled())
                .then(() => fileOrEditorFile(file))
                .then((path) => work.ftp.add(() => fs.isDirectory(path)
                .then(isdir => isdir ? downloadAll(path) : taskTimer('Download', ftpsync.download(path)))).catch(util.error)).catch(util.error);
        },
        'ftpkr.uploadAll'() {
            return cfg.loadTest()
                .then(() => cfg.isFtpDisabled())
                .then(() => workspace.saveAll())
                .then(() => work.ftp.add(() => uploadAll("")).catch(util.error));
        },
        'ftpkr.downloadAll'() {
            return cfg.loadTest()
                .then(() => cfg.isFtpDisabled())
                .then(() => workspace.saveAll())
                .then(() => work.ftp.add(() => downloadAll("")).catch(util.error));
        },
        'ftpkr.cleanAll'() {
            return cfg.loadTest()
                .then(() => cfg.isFtpDisabled())
                .then(() => workspace.saveAll())
                .then(() => work.ftp.add(() => ftpsync.syncTestClean()
                .then((tasks) => reserveSyncTask(tasks, 'Clean All')))
                .catch(util.error));
        },
        'ftpkr.refreshAll'() {
            return cfg.loadTest()
                .then(() => cfg.isFtpDisabled())
                .then(() => work.ftp.add(() => ftpsync.refreshForce()).catch(util.error));
        },
        'ftpkr.list'() {
            return cfg.loadTest()
                .then(() => cfg.isFtpDisabled())
                .then(() => work.ftp.add(() => ftpsync.list('')).catch(util.error));
        },
    }
};
//# sourceMappingURL=ftpsync.js.map