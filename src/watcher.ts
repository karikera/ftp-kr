
import * as vscode from 'vscode';

import * as util from './util/util';

import * as log from './vsutil/log';
import * as file from './vsutil/file';
import * as work from './vsutil/work';
import * as cmd from './vsutil/cmd';

import * as cfg from './config';
import * as ftpsync from './ftpsync';

enum WatcherMode
{
	NONE,
	CONFIG,
	FULL,
}

export class WorkspaceWatcher implements file.WorkspaceItem
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

	constructor(public readonly workspace:file.Workspace)
	{
		this.logger = this.workspace.query(log.Logger);
		this.config = this.workspace.query(cfg.Config);
		this.scheduler = this.workspace.query(work.Scheduler);
		this.ftp = this.workspace.query(ftpsync.FtpSyncManager);

		this.config.onLoad(async(task)=>{
			// await this.ftp.load();
			await this.ftp.init(task);
			this.attachWatcher(this.config.autoUpload || this.config.autoDelete ? WatcherMode.FULL : WatcherMode.CONFIG);
			this.attachOpenWatcher(!!this.config.autoDownload);
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
		path: file.File, 
		workFunc: (this:ftpsync.FtpSyncManager, task:work.Task, path: file.File) => Promise<any>, 
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
				const path = new file.File(e.uri);
				const workspace = path.workspace();
				const config = workspace.query(cfg.Config);
				const scheduler = workspace.query(work.Scheduler);
				const logger = workspace.query(log.Logger);

				try {
					if (!config.autoDownload) return;
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

	async uploadCascade(path: file.File):Promise<void>
	{
		const workspace = path.workspace();
		const config = workspace.query(cfg.Config);

		this.processWatcher(path, this.ftp.upload, 'upload', !!config.autoUpload);
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
		var deleteParent:file.File|null = null; // #1

		this.watcher.onDidChange(uri => {
			this.logger.verbose('watcher.onDidChange: '+uri.fsPath);
			this.watcherQueue = this.watcherQueue.then(()=>{
				const path = new file.File(uri);
				if (deleteParent && path.in(deleteParent)) return; // #1
				this.processWatcher(path, 
					(task, path) => this.ftp.upload(task, path, {doNotMakeDirectory: true}), 
					'upload',
					!!this.config.autoUpload);
			}).catch(err=>this.logger.error(err));
		});
		this.watcher.onDidCreate(uri => {
			const path = new file.File(uri);
			const workspace = path.workspace();
			const logger = workspace.query(log.Logger);
			logger.verbose('watcher.onDidCreate: '+uri.fsPath);
			this.watcherQueue = this.watcherQueue.then(()=>{
				if (deleteParent && deleteParent.fsPath === path.fsPath) deleteParent = null; // #1
				return this.uploadCascade(path);
			}).catch(err=>logger.error(err));
		});
		this.watcher.onDidDelete(uri => {
			const path = new file.File(uri);
			const workspace = path.workspace();
			const logger = workspace.query(log.Logger);
			const config = workspace.query(cfg.Config);
			logger.verbose('watcher.onDidDelete: '+uri.fsPath);
			this.watcherQueue = this.watcherQueue.then(()=>{
				deleteParent = path; // #1
				this.processWatcher(path, 
					this.ftp.remove, 
					'remove',
					!!config.autoDelete);
			}).catch(err=>logger.error(err));
		});
	}

}
