
import * as vscode from 'vscode';
const workspace = vscode.workspace;
const window = vscode.window;

import * as log from '../util/log';
import * as fs from '../util/fs';
import * as work from '../util/work';
import * as util from '../util/util';

import * as cfgex from './config';
import * as cfg from '../config';
import * as ftpsync from '../ftpsync';
import * as ftp from '../ftp';
import * as vsutil from '../vsutil';

const config = cfg.config;

var watcherQueue : Promise<void> = Promise.resolve();
var watcher: vscode.FileSystemWatcher | null = null;
var openWatcher: vscode.Disposable | null = null;

enum WatcherMode
{
	NONE,
	CONFIG,
	FULL,
}

var watcherMode:WatcherMode = WatcherMode.NONE;
var openWatcherMode = false;
var initTime = 0;

const TASK_FILE_PATH = "/.vscode/ftp-kr.task.json";

cfgex.onLoad(async(task)=>{
    if (config.disableFtp) {
        attachOpenWatcher(false);
        attachWatcher(WatcherMode.CONFIG);
        return;
	}
	if (config.keepPasswordInMemory === false)
	{
		ftp.cleanPasswordInMemory();
	}
	await ftpsync.load();
	await ftpsync.init(task);
	attachWatcher(config.autoUpload || config.autoDelete ? WatcherMode.FULL : WatcherMode.CONFIG);
	attachOpenWatcher(!!config.autoDownload);
});
cfgex.onInvalid(() => {
    attachOpenWatcher(false);
    attachWatcher(WatcherMode.CONFIG);
});
cfgex.onNotFound(() => {
    attachOpenWatcher(false);
    attachWatcher(WatcherMode.NONE);
});


function processWatcher(
	path: string, 
	workFunc: (task:work.Task, path: string) => Promise<any>, 
	workName: string,
	autoSync: boolean): void 
{
    function commit():Thenable<void>|void {
        if (!autoSync) return;
        if (cfg.checkIgnorePath(path)) return;
		return work.ftp.task(workName+' '+path, task => workFunc(task, path));
    }
    try {
		let promise = Promise.resolve();

        if (path == cfg.PATH) {
            // #2. 와처가 바로 이전에 생성한 설정 파일에 반응하는 상황을 우회
            if (cfg.testInitTimeBiasForVSBug())
			{
				if (workFunc === ftpsync.upload) {
					vsutil.open(cfg.PATH);
					return;
				}
            }

            vsutil.showLog();
			promise = promise.then(()=>cfgex.load());
            if (watcherMode !== WatcherMode.CONFIG)
				promise = promise.then(commit);
        }
		else
		{
			promise = promise.then(commit);
		}
		promise.catch(vsutil.error);
    }
    catch (err) {
        vsutil.error(err);
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
                if (cfg.checkIgnorePath(workpath)) return;
				work.ftp.task('download '+workpath, task => ftpsync.downloadWithCheck(task, workpath));
            }
            catch (err) {
                vsutil.error(err);
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

async function uploadCascade(path: string):Promise<void>
{
	processWatcher(path, ftpsync.upload, 'upload', !!config.autoUpload);
	try
	{
		if (!(await fs.isDirectory(path))) return;
	}
	catch(err)
	{
		if (err.code === 'ENOENT')
		{
			// already deleted
			return;
		}
		throw err;
	}

	for(const cs of await fs.list(path))
	{
		await uploadCascade(path + '/' + cs);
	}
}

function attachWatcher(mode: WatcherMode): void {
    if (watcherMode === mode) return;
	if (watcher)
	{
		watcher.dispose();
		watcher = null;
	}
	watcherMode = mode;
	log.verbose('watcherMode = '+WatcherMode[mode]);

    var watcherPath = fs.workspace;
    switch (watcherMode) {
        case WatcherMode.FULL: watcherPath += "/**/*"; break;
        case WatcherMode.CONFIG: watcherPath += cfg.PATH; break;
        case WatcherMode.NONE: watcher = null; return;
    }
    watcher = workspace.createFileSystemWatcher(watcherPath);

    // #1. 부모 디렉토리가 삭제된 다음 자식 디렉토리가 갱신되는 상황을 우회
    var deleteParent = ""; // #1

    watcher.onDidChange(e => {
		log.verbose('watcher.onDidChange: '+e.fsPath);
		watcherQueue = watcherQueue.then(()=>{
			const path = fs.worklize(e.fsPath);
			if (deleteParent && path.startsWith(deleteParent + "/")) return; // #1
			processWatcher(path, 
				(task, path) => ftpsync.upload(task, path, {doNotMakeDirectory: true}), 
				'upload',
				!!config.autoUpload);
		}).catch(vsutil.error);
    });
    watcher.onDidCreate(e => {
		log.verbose('watcher.onDidCreate: '+e.fsPath);
		watcherQueue = watcherQueue.then(()=>{
			const path = fs.worklize(e.fsPath);
			if (deleteParent && deleteParent === path) deleteParent = ""; // #1
			return uploadCascade(path);
		}).catch(vsutil.error);
    });
    watcher.onDidDelete(e => {
		log.verbose('watcher.onDidDelete: '+e.fsPath);
		watcherQueue = watcherQueue.then(()=>{
			const path = fs.worklize(e.fsPath);
			deleteParent = path; // #1
			processWatcher(path, 
				ftpsync.remove, 
				'remove',
				!!config.autoDelete);
		}).catch(vsutil.error);
    });
}

async function reserveSyncTaskWith(task:work.Task, tasks: ftpsync.TaskList, taskname: string, options:ftpsync.BatchOptions, infocallback: () => Thenable<string>): Promise<void> {
	try
	{
		for (;;)
		{
			if (util.isEmptyObject(tasks)) 
			{
				vsutil.info("Nothing to DO");
				return;
			}
			vsutil.showLog();
			log.message(taskname + ' started');
			await fs.create(TASK_FILE_PATH, JSON.stringify(tasks, null, 1));
			await vsutil.open(TASK_FILE_PATH);
			const res = await infocallback();
			if (res !== "OK" && res !== "Retry") 
			{
				fs.unlink(TASK_FILE_PATH);
				return;
			}
			const editor = await vsutil.open(TASK_FILE_PATH);
			if (editor) await editor.document.save();
			const startTime = Date.now();
			const data = await fs.json(TASK_FILE_PATH);
			await fs.unlink(TASK_FILE_PATH);
			const failed = await ftpsync.exec(task, data, options);
			if (!failed) 
			{
				const passedTime = Date.now() - startTime;
				if (passedTime > 1000) {
					vsutil.info(taskname + " completed");
				}
				vsutil.showLog();
				log.message(taskname + ' completed');
				return;
			}

			tasks = failed.tasks;
			infocallback = () => vsutil.errorConfirm("ftp-kr Task failed, more information in the output", "Retry");
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
            vsutil.info(taskname + " completed");
        }
    });
}


function reserveSyncTask(task:work.Task, tasks: ftpsync.TaskList, taskname: string, options:ftpsync.BatchOptions): Promise<void> {
    return reserveSyncTaskWith(task, tasks, taskname, options, () => vsutil.info("Review Operations to perform.", "OK"));
}

function uploadAll(task:work.Task, path: string): Promise<void> {
    return ftpsync.syncTestUpload(task, path)
        .then((tasks) => reserveSyncTask(task, tasks, 'Upload All', {doNotRefresh:true}));
}

function downloadAll(task:work.Task, path: string): Promise<void> {
    return ftpsync.syncTestDownload(task, path)
        .then((tasks) => reserveSyncTask(task, tasks, 'Download All', {doNotRefresh:true}));
}

export function load()
{
}
	
export function unload()
{
	ftpsync.saveSync();
}

export const commands = {
	async 'ftpkr.upload'(file: vscode.Uri) {
		vsutil.showLog();
		await cfgex.loadTest()
		await cfgex.isFtpDisabled();
		const path = await vsutil.fileOrEditorFile(file);
		work.ftp.task('ftpkr.upload', async(task) => {
			const isdir = await fs.isDirectory(path);
			if (isdir)
			{
				await uploadAll(task, path);
			}
			else
			{
				await taskTimer('Upload', ftpsync.upload(task, path, {doNotMakeDirectory:true}).then(res => {
					if (res.latestIgnored)
					{
						log.message(`latest: ${path}`);
					}
				}));
			}
		});
	},
	
	async 'ftpkr.download'(file: vscode.Uri) {
		vsutil.showLog();
		await cfgex.loadTest();
		await cfgex.isFtpDisabled();
		const path = await vsutil.fileOrEditorFile(file);
		work.ftp.task('ftpkr.download', async (task) => {
			const isdir = await fs.isDirectory(path);
			if (isdir)
			{
				await downloadAll(task, path);
			}
			else
			{
				await taskTimer('Download', ftpsync.download(task, path))
			}
		});
	},
	
	async 'ftpkr.uploadAll'() {
		await cfgex.loadTest();
		await cfgex.isFtpDisabled();
		await workspace.saveAll();
		work.ftp.taskWithTimeout('ftpkr.uploadAll', 1000, task => uploadAll(task, ""));
	},

	async 'ftpkr.downloadAll'() {
		await cfgex.loadTest();
		await cfgex.isFtpDisabled();
		await workspace.saveAll();
		work.ftp.taskWithTimeout('ftpkr.downloadAll', 1000, task => downloadAll(task, ""));
	},

	async 'ftpkr.cleanAll'() {
		await cfgex.loadTest();
		await cfgex.isFtpDisabled();
		await workspace.saveAll();
		work.ftp.taskWithTimeout('ftpkr.cleanAll', 1000, async (task) => {
			const tasks = await ftpsync.syncTestClean(task);
			await reserveSyncTask(task, tasks, 'ftpkr.Clean All', {doNotRefresh:true});
		});
	},
	async 'ftpkr.refreshAll'() {
		await cfgex.loadTest();
		await cfgex.isFtpDisabled();
		work.ftp.taskWithTimeout('ftpkr.refreshAll', 1000, task => ftpsync.refreshForce(task));
	},
	async 'ftpkr.list'() {
		await cfgex.loadTest();
		await cfgex.isFtpDisabled();
		work.ftp.taskWithTimeout('ftpkr.list', 1000, task => ftpsync.list(task, ''));
	},

};
