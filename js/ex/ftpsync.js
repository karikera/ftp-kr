
const vscode = require('vscode');
const workspace = vscode.workspace;
const window = vscode.window;

const config = require('../config');
const fs = require('../fs');
const ftpsync = require('../ftpsync');
const work = require('../work');
const util = require('../util');
const cfg = require('./config');

var watcher = null;
var watcherMode = "";

const TASK_FILE_PATH = "/.vscode/ftp-kr.task.json";

cfg.onLoad(function(){
	if (config.disableFtp) return attachWatcher("CONFIG");
	
	return ftpsync.load()
	.then(() => ftpsync.refresh(""))
	.then(() => attachWatcher(config.autoUpload || config.autoDelete ? "FULL" : "CONFIG"));	
});
cfg.onInvalid(() => attachWatcher("CONFIG"));
cfg.onNotFound(() => attachWatcher(""));


function processWatcher(path, upload, autoSync)
{
    function commit()
    {
        if (!autoSync) return;
        if (config.checkIgnorePath(path)) return;
        work.ftp.add(()=>upload(path)).catch(util.error);
    }
    try
    {
        if (path == config.PATH)
        {
			util.showLog();
            let promise = cfg.load();
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
        const path = fs.worklize(e.fsPath);
        if (deleteParent && path.startsWith(deleteParent+ "/")) return;
        processWatcher(path, (path) => ftpsync.upload(path, true), config.autoUpload);
    });
    watcher.onDidCreate((e) => {
        const path = fs.worklize(e.fsPath);
        if (deleteParent && deleteParent === path) deleteParent = "";
        processWatcher(path, ftpsync.upload, config.autoUpload);
    });
    watcher.onDidDelete((e) => {
        const path = fs.worklize(e.fsPath);
        deleteParent = path;
        processWatcher(path, ftpsync.delete, config.autoDelete);
    });
}


/**
 * @param {!Object.<string, string>} tasks
 * @param {string} taskname
 * @param {function()} infocallback
 * @return {!Promise}
 */
function reserveSyncTaskWith(tasks, taskname, infocallback)
{
    if (util.isEmptyObject(tasks))
    {
        util.info("Nothing to DO");
        return Promise.resolve();
    }
	util.showLog();
	util.log(taskname+' started');
    return fs.create(TASK_FILE_PATH,JSON.stringify(tasks, null , 1))
    .then(() => util.open(TASK_FILE_PATH))
    .then(infocallback)
    .then((res) => {
        if (res !== "OK" && res !== "Retry")
        {
            fs.delete(TASK_FILE_PATH);
            return;
        }
		const startTime = +new Date();
        return fs.json(TASK_FILE_PATH)
        .then((data) => fs.delete(TASK_FILE_PATH).then(() => ftpsync.exec(data)))
        .then((failed) => {
            if (!failed)
			{
				const passedTime = +new Date() - startTime;
				if (passedTime > 1000)
				{
					util.info(taskname+" completed");
				}
				util.showLog();
				util.log(taskname+' completed');
				return;
			}
            return reserveSyncTaskWith(failed.tasks, taskname, ()=>util.errorConfirm("ftp-kr Task failed, more information in the output", "Retry"));            
        });
    })
    .catch(function (err){
        fs.delete(TASK_FILE_PATH).catch(()=>{});
        throw err;
    });
}

/**
 * @param {string} taskname
 * @param {!Promise} taskpromise
 * @return {!Promise}
 */
function taskTimer(taskname, taskpromise)
{
	const startTime = +new Date();
	return taskpromise.then(()=>{
		const passedTime = +new Date() - startTime;
		if (passedTime > 1000)
		{
			util.info(taskname+" completed");
		}
	});
}


/**
 * @param {!Object.<string, string>} tasks
 * @param {string} taskname
 * @return {!Promise}
 */
function reserveSyncTask(tasks, taskname)
{
    return reserveSyncTaskWith(tasks, taskname, ()=>util.info("This will be occurred. Are you OK?", "OK"));
}


function fileOrEditorFile(file)
{
    try
    {
        if(file)
        {
            const path = fs.worklize(file.fsPath);
            return Promise.resolve(path);
        }
        else
        {
            const editor = window.activeTextEditor;
            if (!editor) throw new Error("No file opened");
            const doc = editor.document;
            const path = fs.worklize(doc.fileName);
            return doc.save().then(() => path);
        }
    }
    catch(err)
    {
        return Promise.reject(err);
    }
}

/**
 * @param {string} path
 */
function uploadAll(path)
{
	return ftpsync.syncTestUpload(path)
	.then((tasks) => reserveSyncTask(tasks, 'Upload All'));
}

/**
 * @param {string} path
 */
function downloadAll(path)
{
	return ftpsync.syncTestDownload(path)
	.then((tasks) => reserveSyncTask(tasks, 'Download All'));
}

module.exports = {
    load () {
    },
    unload() {
        ftpsync.saveSync();
    },

    commands: {
        'ftpkr.upload'(file) {
            return cfg.loadTest()
			.then(() => cfg.isFtpDisabled())
            .then(() => fileOrEditorFile(file))
            .then(
                (path) => work.ftp.add(
					() => fs.isDirectory(path)
					.then(isdir=>isdir ? uploadAll(path) : taskTimer('Upload', ftpsync.upload(path)))
				).catch(util.error)
            ).catch(util.error);
        },
        'ftpkr.download'(file) {
            return cfg.loadTest()
			.then(() => cfg.isFtpDisabled())
            .then(() => fileOrEditorFile(file))
            .then(
                (path) => work.ftp.add(
					() => fs.isDirectory(path)
					.then(isdir=>isdir ? downloadAll(path) : taskTimer('Download', ftpsync.download(path)))
				).catch(util.error)
            ).catch(util.error);
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
            .then(
                () => work.ftp.add(
                    () => ftpsync.syncTestClean()
                    .then((tasks) => reserveSyncTask(tasks, 'Clean All'))
                )
                .catch(util.error)
            );
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

