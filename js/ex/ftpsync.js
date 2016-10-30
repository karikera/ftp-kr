
let vscode = require('vscode');
var workspace = vscode.workspace;
var window = vscode.window;

var config = require('../config');
var fs = require('../fs');
var ftpsync = require('../ftpsync');
var work = require('../work');
var util = require('../util');
var cfg = require('./config');

var watcher = null;
var watcherMode = "";

const TASK_FILE_PATH = "/.vscode/ftp-kr.task.json";

cfg.onLoad(function(){
    return ftpsync.load()
    .then(() => ftpsync.refresh(""))
    .then(() => attachWatcher(config.autosync ? "FULL" : "CONFIG"));
});
cfg.onInvalid(() => attachWatcher("CONFIG"));
cfg.onNotFound(() => attachWatcher(""));


function processWatcher(path, upload)
{
    function commit()
    {
        if (!config.autosync) return;
        if (config.checkIgnorePath(path)) return;
        work.ftp.add(()=>upload(path)).catch(util.error);
    }
    try
    {
        if (path == config.PATH)
        {
            var promise = cfg.load();
            if (watcherMode !== 'CONFIG')
                promise = promise.then(() => commit());
            promise.catch(util.error);
        }
        else
            commit();
    }
    catch(err)
    {
        util.error(err);
    }
}

/**
 * @param {string} mode
 * @return {void}
 */
function attachWatcher(mode)
{
    if (watcherMode === mode) return;
    if (watcher) watcher.dispose();
    watcherMode = mode;
    var watcherPath = fs.workspace;
    switch(watcherMode)
    {
    case "FULL": watcherPath += "/**/*"; break;
    case "CONFIG": watcherPath += config.PATH; break;
    case "": watcher = null; return;
    }
    watcher = workspace.createFileSystemWatcher(watcherPath);
    var deleteParent = ""; // 부모 디렉토리가 삭제된 다음 자식 디렉토리가 갱신되는 상황을 우회
    watcher.onDidChange((e) => {
        var path = fs.worklize(e.fsPath);
        if (deleteParent && path.startsWith(deleteParent+ "/")) return;
        processWatcher(path, (path) => ftpsync.upload(path, true));
    });
    watcher.onDidCreate((e) => {
        var path = fs.worklize(e.fsPath);
        if (deleteParent && deleteParent === path) deleteParent = "";
        processWatcher(path, ftpsync.upload);
    });
    watcher.onDidDelete((e) => {
        var path = fs.worklize(e.fsPath);
        deleteParent = path;
        processWatcher(path, ftpsync.delete);
    });
}


/**
 * @param {!Object.<string, string>} tasks
 * @return {!Promise}
 */
function reserveSyncTaskWith(tasks, infocallback)
{
    if (util.isEmptyObject(tasks))
    {
        util.info("Nothing to DO");
        return Promise.resolve();
    }
    return fs.create(TASK_FILE_PATH,JSON.stringify(tasks, null , 1))
    .then(() => util.open(TASK_FILE_PATH))
    .then(infocallback)
    .then((res) => {
        if (res !== "OK" && res !== "Retry")
        {
            fs.delete(TASK_FILE_PATH);
            return;
        }
        return fs.json(TASK_FILE_PATH)
        .then((data) => fs.delete(TASK_FILE_PATH).then(() => ftpsync.exec(data)))
        .then((failed) => {
            if (!failed) return;
            return reserveSyncTaskWith(failed.tasks, ()=>util.errorConfirm("ftp-kr execution failed: "+failed.count, "Retry"));            
        });
    })
    .catch(function (err){
        fs.delete(TASK_FILE_PATH).catch(()=>{});
        throw err;
    });
}

/**
 * @param {!Object.<string, string>} tasks
 * @return {!Promise}
 */
function reserveSyncTask(tasks)
{
    return reserveSyncTaskWith(tasks, ()=>util.info("This will be occurred. Are you OK?", "OK"));
}


function fileOrEditorFile(file)
{
    try
    {
        if(file)
        {
            var path = fs.worklize(file.fsPath);
            return Promise.resolve(path);
        }
        else
        {
            var editor = window.activeTextEditor;
            if (!editor) throw new Error("No file opened");
            var doc = editor.document;
            var path = fs.worklize(doc.fileName);
            return doc.save().then(() => path);
        }
    }
    catch(err)
    {
        return Promise.reject(err);
    }
}

module.exports = {
    load: function () {
    },
    unload: function() {
        ftpsync.saveSync();
    },

    commands: {
        'ftpkr.upload': function(file) {
            return cfg.loadTest()
            .then(() => fileOrEditorFile(file))
            .then(
                (path) => work.ftp.add(
                    () => ftpsync.upload(path))
                .catch(util.error)
            )
            .catch(util.error);
        },
        'ftpkr.download': function(file) {
            return cfg.loadTest()
            .then(() => fileOrEditorFile(file))
            .then(
                (path) => work.ftp.add(
                    () => ftpsync.download(path))
                .catch(util.error)
            )
            .catch(util.error);
        },
        'ftpkr.uploadAll': function() {
            return cfg.loadTest()
            .then(() => workspace.saveAll())
            .then(
                () => work.ftp.add(
                    () => ftpsync.syncTestUpload()
                    .then((tasks) => reserveSyncTask(tasks))
                ).catch(util.error)
            );
        },

        'ftpkr.downloadAll': function() {
            return cfg.loadTest()
            .then(() => workspace.saveAll())
            .then(
                () => work.ftp.add(
                    () => ftpsync.syncTestDownload()
                    .then((tasks) => reserveSyncTask(tasks))
                )
                .catch(util.error)
            );
        },

        'ftpkr.cleanAll': function() {
            return cfg.loadTest()
            .then(() => workspace.saveAll())
            .then(
                () => work.ftp.add(
                    () => ftpsync.syncTestClean()
                    .then((tasks) => reserveSyncTask(tasks))
                )
                .catch(util.error)
            );
        }
    }
};

