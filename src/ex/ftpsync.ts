
import * as vscode from 'vscode';
const workspace = vscode.workspace;
const window = vscode.window;

import config from '../config';
import * as fs from '../fs';
import * as ftpsync from '../ftpsync';
import * as work from '../work';
import * as util from '../util';
import * as cfg from './config';

var watcherQueue : Promise<void> = Promise.resolve();
var watcher: vscode.FileSystemWatcher | null = null;
var openWatcher: vscode.Disposable | null = null;
var watcherMode = "";
var openWatcherMode = false;
var initTime = 0;

const TASK_FILE_PATH = "/.vscode/ftp-kr.task.json";

cfg.onLoad(function () {
    if (config.disableFtp) {
        attachOpenWatcher(false);
        attachWatcher("CONFIG");
        return;
    }

    return ftpsync.load()
        .then(() => ftpsync.refresh(""))
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


function processWatcher(path: string, upload: (path: string) => Promise<any>, autoSync: boolean): void {
    function commit() {
        if (!autoSync) return;
        if (config.checkIgnorePath(path)) return;
		work.ftp.reserveWork('upload '+path, () => upload(path))
		.catch(util.error);
    }
    try {
        if (path == config.PATH) {
            // #2. 와처가 바로 이전에 생성한 설정 파일에 반응하는 상황을 우회
            if (config.initTimeForVSBug) {
                const inittime = config.initTimeForVSBug;
                config.initTimeForVSBug = 0;
                if (upload === ftpsync.upload) {
                    if (Date.now() <= inittime + 500) {
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
    catch (err) {
        util.error(err);
    }
}

function attachOpenWatcher(mode: boolean): void {
    if (openWatcherMode === mode) return;
    openWatcherMode = mode;
    if (mode) {
        openWatcher = workspace.onDidOpenTextDocument(e => {
            const workpath = fs.worklize(e.fileName);
            try {
                if (!config.autoDownload) return;
                if (config.checkIgnorePath(workpath)) return;
				work.ftp.reserveWork('download '+workpath, () => ftpsync.downloadWithCheck(workpath))
				.catch(util.error);
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

async function uploadCascade(path: string)
{
	processWatcher(path, ftpsync.upload, !!config.autoUpload);
	if (!(await fs.isDirectory(path))) return;

	for(const cs of await fs.list(path))
	{
		await uploadCascade(path + '/' + cs);
	}
}

function attachWatcher(mode: string): void {
    if (watcherMode === mode) return;
    if (watcher) watcher.dispose();
    watcherMode = mode;
    var watcherPath = fs.workspace;
    switch (watcherMode) {
        case "FULL": watcherPath += "/**/*"; break;
        case "CONFIG": watcherPath += config.PATH; break;
        case "": watcher = null; return;
    }
    watcher = workspace.createFileSystemWatcher(watcherPath);

    // #1. 부모 디렉토리가 삭제된 다음 자식 디렉토리가 갱신되는 상황을 우회
    var deleteParent = ""; // #1

    watcher.onDidChange(e => {
		watcherQueue = watcherQueue.then(()=>{
			const path = fs.worklize(e.fsPath);
			if (deleteParent && path.startsWith(deleteParent + "/")) return; // #1
			processWatcher(path, path => ftpsync.upload(path, {doNotMakeDirectory: true}), !!config.autoUpload);
		});
    });
    watcher.onDidCreate(e => {
		watcherQueue = watcherQueue.then(()=>{
			const path = fs.worklize(e.fsPath);
			if (deleteParent && deleteParent === path) deleteParent = ""; // #1
			return uploadCascade(path);
		});
    });
    watcher.onDidDelete(e => {
		watcherQueue = watcherQueue.then(()=>{
			const path = fs.worklize(e.fsPath);
			deleteParent = path; // #1
			processWatcher(path, ftpsync.remove, !!config.autoDelete);
		});
    });
}

async function reserveSyncTaskWith(tasks: ftpsync.TaskList, taskname: string, options:ftpsync.BatchOptions, infocallback: () => Thenable<string>): Promise<void> {
	try
	{
		for (;;)
		{
			if (util.isEmptyObject(tasks)) 
			{
				util.info("Nothing to DO");
				return;
			}
			util.showLog();
			util.log(taskname + ' started');
			await fs.create(TASK_FILE_PATH, JSON.stringify(tasks, null, 1));
			await util.open(TASK_FILE_PATH);
			const res = await infocallback();
			if (res !== "OK" && res !== "Retry") 
			{
				fs.unlink(TASK_FILE_PATH);
				return;
			}
			const editor = await util.open(TASK_FILE_PATH);
			if (editor) await editor.document.save();
			const startTime = Date.now();
			const data = await fs.json(TASK_FILE_PATH);
			await fs.unlink(TASK_FILE_PATH);
			const failed = await ftpsync.exec(data, options);
			if (!failed) 
			{
				const passedTime = Date.now() - startTime;
				if (passedTime > 1000) {
					util.info(taskname + " completed");
				}
				util.showLog();
				util.log(taskname + ' completed');
				return;
			}

			tasks = failed.tasks;
			infocallback = () => util.errorConfirm("ftp-kr Task failed, more information in the output", "Retry");
		}
	}
	catch(err)
	{
		try
		{
			await fs.unlink(TASK_FILE_PATH);
		}
		catch(e)
		{
		}
		throw err;
	}
}

function taskTimer(taskname: string, taskpromise: Promise<void>): Promise<void> {
    const startTime = Date.now();
    return taskpromise.then(() => {
        const passedTime = Date.now() - startTime;
        if (passedTime > 1000) {
            util.info(taskname + " completed");
        }
    });
}


function reserveSyncTask(tasks: ftpsync.TaskList, taskname: string, options:ftpsync.BatchOptions): Promise<void> {
    return reserveSyncTaskWith(tasks, taskname, options, () => util.info("Review Operations to perform.", "OK"));
}

function uploadAll(path: string): Promise<void> {
    return ftpsync.syncTestUpload(path)
        .then((tasks) => reserveSyncTask(tasks, 'Upload All', {doNotRefresh:true}));
}

function downloadAll(path: string): Promise<void> {
    return ftpsync.syncTestDownload(path)
        .then((tasks) => reserveSyncTask(tasks, 'Download All', {doNotRefresh:true}));
}

module.exports = {
    load() {
    },
    unload() {
        ftpsync.saveSync();
    },

    commands: {
        async 'ftpkr.upload'(file: vscode.Uri) {
			util.showLog();
			await cfg.loadTest()
			await cfg.isFtpDisabled();
			const path = await util.fileOrEditorFile(file);
			await work.ftp.work('ftpkr.upload', async() => {
				const isdir = await fs.isDirectory(path);
				if (isdir)
				{
					await uploadAll(path);
				}
				else
				{
					await taskTimer('Upload', ftpsync.upload(path, {doNotMakeDirectory:true}).then(res => {
						if (res.latestIgnored)
						{
							util.log(`latest: ${path}`);
						}
					}));
				}
			});
		},
		
        async 'ftpkr.download'(file: vscode.Uri) {
			util.showLog();
            await cfg.loadTest();
            await cfg.isFtpDisabled();
			const path = await util.fileOrEditorFile(file);
			await work.ftp.work('ftpkr.download', async () => {
				const isdir = await fs.isDirectory(path);
				if (isdir)
				{
					await downloadAll(path);
				}
				else
				{
					await taskTimer('Download', ftpsync.download(path))
				}
			});
		},
		
        async 'ftpkr.uploadAll'() {
			await cfg.loadTest();
			await cfg.isFtpDisabled();
			await workspace.saveAll();
            await work.ftp.work('ftpkr.uploadAll', () => uploadAll(""));
        },

        async 'ftpkr.downloadAll'() {
			await cfg.loadTest();
			await cfg.isFtpDisabled();
			await workspace.saveAll();
			await work.ftp.work('ftpkr.downloadAll', () => downloadAll(""));
        },

        async 'ftpkr.cleanAll'() {
			await cfg.loadTest();
			await cfg.isFtpDisabled();
			await workspace.saveAll();
			await work.ftp.work('ftpkr.cleanAll', async () => {
				const tasks = await ftpsync.syncTestClean();
				await reserveSyncTask(tasks, 'ftpkr.Clean All', {doNotRefresh:true});
			});
        },
        async 'ftpkr.refreshAll'() {
			await cfg.loadTest();
			await cfg.isFtpDisabled();
            await work.ftp.work('ftpkr.refreshAll', () => ftpsync.refreshForce());
        },
        async 'ftpkr.list'() {
            await cfg.loadTest();
            await cfg.isFtpDisabled();
            await work.ftp.work('ftpkr.list', () => ftpsync.list(''));
        },

    }
};

