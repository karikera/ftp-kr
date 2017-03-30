
import * as vscode from 'vscode';
const workspace = vscode.workspace;
const window = vscode.window;

import config from '../config';
import * as fs from '../fs';
import * as ftpsync from '../ftpsync';
import * as work from '../work';
import * as util from '../util';
import * as cfg from './config';

var watcher:vscode.FileSystemWatcher|null = null;
var openWatcher:vscode.Disposable|null = null;
var watcherMode = "";
var openWatcherMode = false;
var initTime = 0;

const TASK_FILE_PATH = "/.vscode/ftp-kr.task.json";

cfg.onLoad(function(){
	if (config.disableFtp)
	{
		attachOpenWatcher(false);
		attachWatcher("CONFIG");
		return;
	}
	
	return ftpsync.load()
	.then(()=>ftpsync.refresh(""))
	.then(() => {
		attachWatcher(config.autoUpload || config.autoDelete ? "FULL" : "CONFIG");
		attachOpenWatcher(!!config.autoDownload);
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


function processWatcher(path:string, upload:(path:string)=>void, autoSync:boolean):void
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
	 		// #2. 와처가 바로 이전에 생성한 설정 파일에 반응하는 상황을 우회
			if (config.initTimeForVSBug)
			{
				const inittime = config.initTimeForVSBug;
				config.initTimeForVSBug = 0;
				if (upload === ftpsync.upload)
				{
					if (Date.now() <= inittime + 500)
					{
						util.open(config.PATH);
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
    catch(err)
    {
        util.error(err);
    }
}

function attachOpenWatcher(mode:boolean):void
{
	if (openWatcherMode === mode) return;
	openWatcherMode = mode;
	if (mode)
	{
		openWatcher = workspace.onDidOpenTextDocument(e=>{
			const workpath = fs.worklize(e.fileName);
			try
			{
				if (!config.autoDownload) return;
				if (config.checkIgnorePath(workpath)) return;
				work.ftp.add(()=>ftpsync.downloadWithCheck(workpath)).catch(util.error);
			}
			catch(err)
			{
				util.error(err);
			}
		});
	}
	else
	{
		if (openWatcher)
		{
			openWatcher.dispose();
			openWatcher = null;
		}
	}
}

function attachWatcher(mode:string):void
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

	 // #1. 부모 디렉토리가 삭제된 다음 자식 디렉토리가 갱신되는 상황을 우회
    var deleteParent = ""; // #1
	
    watcher.onDidChange(e => {
        const path = fs.worklize(e.fsPath);
        if (deleteParent && path.startsWith(deleteParent+ "/")) return; // #1
        processWatcher(path, path => ftpsync.upload(path, true), !!config.autoUpload);
    });
    watcher.onDidCreate(e => {
        const path = fs.worklize(e.fsPath);
        if (deleteParent && deleteParent === path) deleteParent = ""; // #1
        processWatcher(path, ftpsync.upload, !!config.autoUpload);
    });
    watcher.onDidDelete(e => {
        const path = fs.worklize(e.fsPath);
        deleteParent = path; // #1
        processWatcher(path, ftpsync.remove, !!config.autoDelete);
    });
}

function reserveSyncTaskWith(tasks:ftpsync.TaskList, taskname:string, infocallback:()=>Thenable<string>):Promise<void>
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
            fs.unlink(TASK_FILE_PATH);
            return;
        }
		const startTime = Date.now();
        return fs.json(TASK_FILE_PATH)
        .then((data) => fs.unlink(TASK_FILE_PATH).then(() => ftpsync.exec(data)))
        .then((failed) => {
            if (!failed)
			{
				const passedTime = Date.now() - startTime;
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
        fs.unlink(TASK_FILE_PATH).catch(()=>{});
        throw err;
    });
}

function taskTimer(taskname:string, taskpromise:Promise<void>):Promise<void>
{
	const startTime = Date.now();
	return taskpromise.then(()=>{
		const passedTime = Date.now() - startTime;
		if (passedTime > 1000)
		{
			util.info(taskname+" completed");
		}
	});
}


function reserveSyncTask(tasks:ftpsync.TaskList, taskname:string):Promise<void>
{
    return reserveSyncTaskWith(tasks, taskname, ()=>util.info("This will be occurred. Are you OK?", "OK"));
}

function fileOrEditorFile(file:vscode.Uri):Thenable<string>
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

function uploadAll(path:string):Promise<void>
{
	return ftpsync.syncTestUpload(path)
	.then((tasks) => reserveSyncTask(tasks, 'Upload All'));
}

function downloadAll(path:string):Promise<void>
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
        'ftpkr.upload'(file:vscode.Uri) {
            return cfg.loadTest()
			.then(() => cfg.isFtpDisabled())
            .then(() => fileOrEditorFile(file))
            .then(
                (path) => work.ftp.add(
					() => fs.isDirectory(path)
					.then(isdir=>isdir ? uploadAll(path) : taskTimer('Upload', ftpsync.upload(path).then(()=>{})))
				).catch(util.error)
            ).catch(util.error);
        },
        'ftpkr.download'(file:vscode.Uri) {
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

