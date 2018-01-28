
import * as vscode from 'vscode';

import {File} from './util/File';
import * as util from './util/util';

import * as log from './vsutil/log';
import * as ws from './vsutil/ws';
import * as work from './vsutil/work';
import * as cmd from './vsutil/cmd';
import * as error from './vsutil/error';

import * as cfg from './config';
import * as ftpsync from './ftpsync';

enum WatcherMode
{
	NONE,
	CONFIG,
	FULL,
}

export class WorkspaceWatcher implements ws.WorkspaceItem
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

	constructor(public readonly workspace:ws.Workspace)
	{
		this.logger = this.workspace.query(log.Logger);
		this.config = this.workspace.query(cfg.Config);
		this.scheduler = this.workspace.query(work.Scheduler);
		this.ftp = this.workspace.query(ftpsync.FtpSyncManager);

		this.config.onLoad(async(task)=>{
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
		
		this.config.path.exists().then(exists=>{
			if (exists)
			{
				this.attachWatcher(WatcherMode.CONFIG);
				this.config.load().catch(err=>error.processError(this.logger, err));
			}
		});
		
		// It has many bug, not completed code
		// this.ftp.onCreated = path=>{
		// 	this.logger.verbose("ftp.onCreated: "+path);
		// };
		// this.ftp.onModified = path=>{
		// 	this.logger.verbose("ftp.onModified: "+path);
		// };
		// this.ftp.onDeleted = path=>{
		// 	this.logger.verbose("ftp.onDeleted: "+path);
		// };
	}

	dispose()
	{
		this.attachWatcher(WatcherMode.NONE);
	}

	async processWatcher(
		path: File, 
		workFunc: (task:work.Task, path: File) => Promise<any>, 
		workName: string,
		autoSync: boolean): Promise<void>
	{
		try
		{
			if (path.fsPath == this.config.path.fsPath) {
				// #2. 와처가 바로 이전에 생성한 설정 파일에 반응하는 상황을 우회
				if (cfg.testInitTimeBiasForVSBug())
				{
					if (workName === 'upload') return;
				}

				this.logger.show();
				const mode = this.watcherMode;
				await this.config.load();
				if (mode === WatcherMode.CONFIG) return;
			}
			if (!autoSync) return;
			if (this.config.checkIgnorePath(path)) return;
			if (!path.in(this.config.basePath)) return;
			await this.scheduler.task(workName+' '+this.config.workpath(path), 
				work.NORMAL,
				task => workFunc(task, path));
		}
		catch (err) {
			error.processError(this.logger, err);
		}
	}

	attachOpenWatcher(mode: boolean): void {
		if (this.openWatcherMode === mode) return;
		this.openWatcherMode = mode;
		if (mode) {
			this.openWatcher = vscode.workspace.onDidOpenTextDocument(e => {
				try {
					const path = new File(e.uri.fsPath);
					var workspace:ws.Workspace;
					try
					{
						workspace = ws.getFromFile(path);
					}
					catch (err)
					{
						return;
					}
					const config = workspace.query(cfg.Config);
					const scheduler = workspace.query(work.Scheduler);
					const logger = workspace.query(log.Logger);
	
					if (!config.autoDownload) return;
					if (config.checkIgnorePath(path)) return;
					if (!path.in(this.config.basePath)) return;
					scheduler.task('download '+config.workpath(path),
						work.NORMAL,
						task => this.ftp.downloadWithCheck(task, path))
						.catch(err=>error.processError(this.logger, err));
				}
				catch (err) {
					error.processError(this.logger, err);
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

	async uploadCascade(path: File):Promise<void>
	{
		const workspace = ws.getFromFile(path);
		const config = workspace.query(cfg.Config);

		this.processWatcher(path, (task, path)=>this.ftp.upload(task, path, {ignoreNotExistFile: true}), 'upload', !!config.autoUpload);
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

		this.watcher.onDidChange(uri => {
			this.logger.verbose('watcher.onDidChange: '+uri.fsPath);
			this.watcherQueue = this.watcherQueue.then(()=>{
				const path = new File(uri.fsPath);
				return this.processWatcher(path, 
					(task, path) => this.ftp.upload(task, path, {doNotMakeDirectory: true, ignoreNotExistFile: true}), 
					'upload',
					!!this.config.autoUpload);
			}).catch(err=>this.logger.error(err));
		});
		this.watcher.onDidCreate(uri => {
			const path = new File(uri.fsPath);
			const workspace = ws.getFromFile(path);
			const logger = workspace.query(log.Logger);
			logger.verbose('watcher.onDidCreate: '+uri.fsPath);
			this.watcherQueue = this.watcherQueue.then(()=>{
				return this.uploadCascade(path);
			}).catch(err=>logger.error(err));
		});
		this.watcher.onDidDelete(uri => {
			const path = new File(uri.fsPath);
			const workspace = ws.getFromFile(path);
			const logger = workspace.query(log.Logger);
			const config = workspace.query(cfg.Config);
			logger.verbose('watcher.onDidDelete: '+uri.fsPath);
			this.watcherQueue = this.watcherQueue.then(()=>{
				return this.processWatcher(path, 
					this.ftp.remove, 
					'remove',
					!!config.autoDelete);
			}).catch(err=>logger.error(err));
		});
	}

}
