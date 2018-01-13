
import * as vscode from 'vscode';
const window = vscode.window;

import * as log from '../util/log';
import * as fs from '../util/fs';
import * as work from '../util/work';
import * as util from '../util/util';
import * as vsutil from '../util/vsutil';
import * as cmd from '../util/cmd';

import * as cfg from '../config';
import * as ftpsync from '../ftpsync';
import * as ftp from '../ftp';

enum WatcherMode
{
	NONE,
	CONFIG,
	FULL,
}

const TASK_FILE_PATH = fs.Path.parse("/.vscode/ftp-kr.task.json");

function taskTimer(taskname: string, taskpromise: Promise<void>): Promise<void> {
	const startTime = Date.now();
	return taskpromise.then(() => {
		const passedTime = Date.now() - startTime;
		if (passedTime > 1000) {
			vsutil.info(taskname + " completed");
		}
	});
}


class WorkspaceWatcher implements fs.WorkspaceItem
{
	private watcherQueue : Promise<void> = Promise.resolve();
	private watcher: vscode.FileSystemWatcher | null = null;
	private openWatcher: vscode.Disposable | null = null;
	
	private watcherMode:WatcherMode = WatcherMode.NONE;
	private openWatcherMode = false;
	
	private readonly logger:log.Logger;
	private readonly config:cfg.Config;
	private readonly scheduler:work.Scheduler;
	private readonly ftp:ftpsync.FtpSyncManager;

	constructor(public readonly workspace:fs.Workspace)
	{
		this.logger = this.workspace.query(log.Logger);
		this.config = this.workspace.query(cfg.Config);
		this.scheduler = this.workspace.query(work.Scheduler);
		this.ftp = this.workspace.query(ftpsync.FtpSyncManager);

		this.config.onLoad(async(task)=>{
			if (this.config.options.disableFtp) {
				this.attachOpenWatcher(false);
				this.attachWatcher(WatcherMode.CONFIG);
				return;
			}
			if (this.config.options.keepPasswordInMemory === false)
			{
				this.workspace.query(ftp.FtpManager).cleanPasswordInMemory();
			}
			await this.ftp.load();
			await this.ftp.init(task);
			this.attachWatcher(this.config.options.autoUpload || this.config.options.autoDelete ? WatcherMode.FULL : WatcherMode.CONFIG);
			this.attachOpenWatcher(!!this.config.options.autoDownload);
		});
		this.config.onInvalid(() => {
			this.attachOpenWatcher(false);
			this.attachWatcher(WatcherMode.CONFIG);
		});
		this.config.onNotFound(() => {
			this.attachOpenWatcher(false);
			this.attachWatcher(WatcherMode.NONE);
		});
	}

	dispose()
	{
		this.attachWatcher(WatcherMode.NONE);
	}

	async processWatcher(
		path: fs.Path, 
		workFunc: (this:ftpsync.FtpSyncManager, task:work.Task, path: fs.Path) => Promise<any>, 
		workName: string,
		autoSync: boolean): Promise<void>
	{
		try
		{
			if (path.fsPath == this.config.path.fsPath) {
				// #2. 와처가 바로 이전에 생성한 설정 파일에 반응하는 상황을 우회
				if (cfg.testInitTimeBiasForVSBug())
				{
					if (workFunc === this.ftp.upload) return;
				}

				this.logger.show();
				const mode = this.watcherMode;
				await this.config.load();
				if (mode === WatcherMode.CONFIG) return;
			}
			if (!autoSync) return;
			if (this.config.checkIgnorePath(path)) return;
			await this.scheduler.task(workName+' '+path.workpath(), task => workFunc.call(this.ftp, task, path));
		}
		catch (err) {
			this.logger.error(err);
		}
	}

	attachOpenWatcher(mode: boolean): void {
		if (this.openWatcherMode === mode) return;
		this.openWatcherMode = mode;
		if (mode) {
			this.openWatcher = vscode.workspace.onDidOpenTextDocument(e => {
				const path = new fs.Path(e.uri);
				const workspace = path.workspace();
				const config = workspace.query(cfg.Config);
				const scheduler = workspace.query(work.Scheduler);
				const logger = workspace.query(log.Logger);

				try {
					if (!config.options.autoDownload) return;
					if (config.checkIgnorePath(path)) return;
					scheduler.task('download '+path, task => this.ftp.downloadWithCheck(task, path));
				}
				catch (err) {
					logger.error(err);
				}
			});
		}
		else {
			if (this.openWatcher) {
				this.openWatcher.dispose();
				this.openWatcher = null;
			}
		}
	}

	async uploadCascade(path: fs.Path):Promise<void>
	{
		const workspace = path.workspace();
		const config = workspace.query(cfg.Config);

		this.processWatcher(path, this.ftp.upload, 'upload', !!config.options.autoUpload);
		try
		{
			if (!(await path.isDirectory())) return;
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

		for(const cs of await path.children())
		{
			await this.uploadCascade(cs);
		}
	}

	attachWatcher(mode: WatcherMode): void {
		if (this.watcherMode === mode) return;
		if (this.watcher)
		{
			this.watcher.dispose();
			this.watcher = null;
		}
		this.watcherMode = mode;
		this.logger.verbose('watcherMode = '+WatcherMode[mode]);

		var watcherPath:string;
		switch (this.watcherMode) {
			case WatcherMode.FULL: watcherPath = this.workspace.fsPath + "/**/*"; break;
			case WatcherMode.CONFIG: watcherPath = this.config.path.fsPath; break;
			case WatcherMode.NONE: this.watcher = null; return;
			default: return;
		}

		this.watcher = vscode.workspace.createFileSystemWatcher(watcherPath);

		// #1. 부모 디렉토리가 삭제된 다음 자식 디렉토리가 갱신되는 상황을 우회
		var deleteParent:fs.Path|null = null; // #1

		this.watcher.onDidChange(uri => {
			this.logger.verbose('watcher.onDidChange: '+uri.fsPath);
			this.watcherQueue = this.watcherQueue.then(()=>{
				const path = new fs.Path(uri);
				if (deleteParent && path.in(deleteParent)) return; // #1
				this.processWatcher(path, 
					(task, path) => this.ftp.upload(task, path, {doNotMakeDirectory: true}), 
					'upload',
					!!this.config.options.autoUpload);
			}).catch(err=>this.logger.error(err));
		});
		this.watcher.onDidCreate(uri => {
			const path = new fs.Path(uri);
			const workspace = path.workspace();
			const logger = workspace.query(log.Logger);
			logger.verbose('watcher.onDidCreate: '+uri.fsPath);
			this.watcherQueue = this.watcherQueue.then(()=>{
				if (deleteParent && deleteParent.fsPath === path.fsPath) deleteParent = null; // #1
				return this.uploadCascade(path);
			}).catch(err=>logger.error(err));
		});
		this.watcher.onDidDelete(uri => {
			const path = new fs.Path(uri);
			const workspace = path.workspace();
			const logger = workspace.query(log.Logger);
			const config = workspace.query(cfg.Config);
			logger.verbose('watcher.onDidDelete: '+uri.fsPath);
			this.watcherQueue = this.watcherQueue.then(()=>{
				deleteParent = path; // #1
				this.processWatcher(path, 
					this.ftp.remove, 
					'remove',
					!!config.options.autoDelete);
			}).catch(err=>logger.error(err));
		});
	}

	async reserveSyncTaskWith(task:work.Task, tasks: ftpsync.TaskList, taskname: string, options:ftpsync.BatchOptions, infocallback: () => Thenable<string|undefined>): Promise<void> {
		try
		{
			for (;;)
			{
				if (util.isEmptyObject(tasks)) 
				{
					vsutil.info("Nothing to DO");
					return;
				}
				this.logger.show();
				this.logger.message(taskname + ' started');
				await TASK_FILE_PATH.create(JSON.stringify(tasks, null, 1));
				await vsutil.open(TASK_FILE_PATH);
				const res = await infocallback();
				if (res !== "OK" && res !== "Retry") 
				{
					TASK_FILE_PATH.unlink();
					return;
				}
				const editor = await vsutil.open(TASK_FILE_PATH);
				if (editor) await editor.document.save();
				const startTime = Date.now();
				const data = await TASK_FILE_PATH.json();
				await TASK_FILE_PATH.unlink();
				const failed = await this.ftp.exec(task, data, options);
				if (!failed) 
				{
					const passedTime = Date.now() - startTime;
					if (passedTime > 1000) {
						vsutil.info(taskname + " completed");
					}
					this.logger.show();
					this.logger.message(taskname + ' completed');
					return;
				}

				tasks = failed.tasks;
				infocallback = () => this.logger.errorConfirm("ftp-kr Task failed, more information in the output", "Retry");
			}
		}
		catch(err)
		{
			try
			{
				await TASK_FILE_PATH.unlink();
			}
			catch(e)
			{
			}
			throw err;
		}
	}

	reserveSyncTask(task:work.Task, tasks: ftpsync.TaskList, taskname: string, options:ftpsync.BatchOptions): Promise<void> {
		return this.reserveSyncTaskWith(task, tasks, taskname, options, () => vsutil.info("Review Operations to perform.", "OK"));
	}

	uploadAll(task:work.Task, path: fs.Path): Promise<void> {
		return this.ftp.syncTestUpload(task, path)
			.then((tasks) => this.reserveSyncTask(task, tasks, 'Upload All', {doNotRefresh:true}));
	}

	downloadAll(task:work.Task, path: fs.Path): Promise<void> {
		return this.ftp.syncTestDownload(task, path)
			.then((tasks) => this.reserveSyncTask(task, tasks, 'Download All', {doNotRefresh:true}));
	}

}

cmd.commands['ftpkr.upload'] =	async (args: cmd.Args) => {
	if (!args.file) return vsutil.info('File is not selected');
	if (!args.workspace) throw Error('workspace is not defined');

	const logger = args.workspace.query(log.Logger);
	const config = args.workspace.query(cfg.Config);
	const scheduler = args.workspace.query(work.Scheduler);
	const watcher = args.workspace.query(WorkspaceWatcher);
	const ftp = args.workspace.query(ftpsync.FtpSyncManager);
	logger.show();

	await config.loadTest();
	await config.isFtpDisabled();

	const path = args.file;
	scheduler.task('ftpkr.upload', async(task) => {
		const isdir = await path.isDirectory();
		if (isdir)
		{
			await watcher.uploadAll(task, path);
		}
		else
		{
			await taskTimer('Upload', ftp.upload(task, path, {doNotMakeDirectory:true}).then(res => {
				if (res.latestIgnored)
				{
					logger.message(`latest: ${path.workpath()}`);
				}
			}));
		}
	});
};

cmd.commands['ftpkr.download'] = async (args: cmd.Args) => {
	if (!args.file) return vsutil.info('File is not selected');
	if (!args.workspace) throw Error('workspace is not defined');

	const logger = args.workspace.query(log.Logger);
	const config = args.workspace.query(cfg.Config);
	const scheduler = args.workspace.query(work.Scheduler);
	const watcher = args.workspace.query(WorkspaceWatcher);
	const ftp = args.workspace.query(ftpsync.FtpSyncManager);
	logger.show();
	
	await config.loadTest();
	await config.isFtpDisabled();

	const path = args.file;
	scheduler.task('ftpkr.download', async (task) => {
		const isdir = await path.isDirectory();
		if (isdir)
		{
			await watcher.downloadAll(task, path);
		}
		else
		{
			await taskTimer('Download', ftp.download(task, path))
		}
	});
};
	
cmd.commands['ftpkr.uploadAll'] = async (args: cmd.Args) => {
	if (!args.workspace)
	{
		args.workspace = await vsutil.selectWorkspace();
		if (!args.workspace) return;
	}

	const workspace = args.workspace;
	const config = workspace.query(cfg.Config);
	const scheduler = workspace.query(work.Scheduler);
	const watcher = workspace.query(WorkspaceWatcher);

	await config.loadTest();
	await config.isFtpDisabled();
	await vscode.workspace.saveAll();
	scheduler.taskWithTimeout('ftpkr.uploadAll', 1000, task => watcher.uploadAll(task, workspace));
};

cmd.commands['ftpkr.downloadAll'] = async (args: cmd.Args) => {
	if (!args.workspace)
	{
		args.workspace = await vsutil.selectWorkspace();
		if (!args.workspace) return;
	}

	const workspace = args.workspace;
	const config = workspace.query(cfg.Config);
	const scheduler = workspace.query(work.Scheduler);
	const watcher = workspace.query(WorkspaceWatcher);

	await config.loadTest();
	await config.isFtpDisabled();
	await vscode.workspace.saveAll();
	scheduler.taskWithTimeout('ftpkr.downloadAll', 1000, task => watcher.downloadAll(task, workspace));
};

cmd.commands['ftpkr.cleanAll'] = async (args: cmd.Args) => {
	if (!args.workspace)
	{
		args.workspace = await vsutil.selectWorkspace();
		if (!args.workspace) return;
	}
	
	const workspace = args.workspace;
	const config = workspace.query(cfg.Config);
	const scheduler = workspace.query(work.Scheduler);
	const watcher = workspace.query(WorkspaceWatcher);
	const ftp = workspace.query(ftpsync.FtpSyncManager);

	await config.loadTest();
	await config.isFtpDisabled();
	await vscode.workspace.saveAll();
	scheduler.taskWithTimeout('ftpkr.cleanAll', 1000, async (task) => {
		const tasks = await ftp.syncTestClean(task);
		await watcher.reserveSyncTask(task, tasks, 'ftpkr.Clean All', {doNotRefresh:true});
	});
},
cmd.commands['ftpkr.refreshAll'] = async (args: cmd.Args) => {
	if (!args.workspace)
	{
		args.workspace = await vsutil.selectWorkspace();
		if (!args.workspace) return;
	}
	
	const workspace = args.workspace;
	const config = workspace.query(cfg.Config);
	const scheduler = workspace.query(work.Scheduler);
	const ftp = workspace.query(ftpsync.FtpSyncManager);

	await config.loadTest();
	await config.isFtpDisabled();
	scheduler.taskWithTimeout('ftpkr.refreshAll', 1000, task => ftp.refreshForce(task));
};
cmd.commands['ftpkr.list'] = async (args: cmd.Args) => {
	if (!args.workspace)
	{
		args.workspace = await vsutil.selectWorkspace();
		if (!args.workspace) return;
	}
	
	const workspace = args.workspace;
	const config = workspace.query(cfg.Config);
	const scheduler = workspace.query(work.Scheduler);
	const ftp = workspace.query(ftpsync.FtpSyncManager);

	await config.loadTest();
	await config.isFtpDisabled();
	scheduler.taskWithTimeout('ftpkr.list', 1000, task => ftp.list(task, workspace));
};

fs.onNewWorkspace(workspace=>workspace.query(WorkspaceWatcher));
