
import { FileSystemWatcher, Disposable, workspace } from 'vscode';
import { File } from 'krfile';

import { PRIORITY_NORMAL, Scheduler, Task } from './vsutil/work';
import { Workspace, WorkspaceItem } from './vsutil/ws';
import { Logger } from './vsutil/log';
import { processError } from './vsutil/error';

import { FtpSyncManager } from './ftpsync';
import { Config, testInitTimeBiasForVSBug } from './config';
import { ConfigProperties } from './util/ftpkr_config';

enum WatcherMode
{
	NONE,
	CONFIG,
	FULL,
}

function ignoreVsCodeDir(config:ConfigProperties):void
{
	for (var i=0;i<config.ignore.length;)
	{
		const ignore = config.ignore[i];
		if (ignore === '/.vscode')
		{
			config.ignore.splice(i, 1);
		}
		else if(ignore.startsWith('/.vscode/'))
		{
			config.ignore.splice(i, 1);
		}
		else
		{
			i++;
		}
	}
	config.ignore.push('/.vscode');
}

export class WorkspaceWatcher implements WorkspaceItem
{
	private watcherQueue : Promise<void> = Promise.resolve();
	private watcher: FileSystemWatcher | null = null;
	private openWatcher: Disposable | null = null;
	
	private watcherMode:WatcherMode = WatcherMode.NONE;
	private openWatcherMode = false;
	
	private readonly logger:Logger
	private readonly config:Config;
	private readonly scheduler:Scheduler;
	private readonly ftp:FtpSyncManager;

	constructor(public readonly workspace:Workspace)
	{
		this.logger = this.workspace.query(Logger);
		this.config = this.workspace.query(Config);
		this.scheduler = this.workspace.query(Scheduler);
		this.ftp = this.workspace.query(FtpSyncManager);

		this.config.onLoad(async(task)=>{
			await this.ftp.onLoadConfig(task);
			this.attachWatcher(this.config.autoUpload || this.config.autoDelete ? WatcherMode.FULL : WatcherMode.CONFIG);
			this.attachOpenWatcher(this.config.autoDownload);
			
			if (!this.config.ignoreJsonUploadCaution && !this.config.checkIgnorePath(this.config.path))
			{
				this.logger.errorConfirm("ftp-kr CAUTION: ftp-kr.json is uploaded to remote. Are you sure?", "Delete and Ignore /.vscode path", "It's OK").then(async(selected)=>{
					switch (selected)
					{
					case "Delete and Ignore /.vscode path":
						this.config.updateIgnorePath();
						for(const server of this.ftp.servers.values())
						{
							await server.ftpDelete(this.config.basePath.child('.vscode'), task);
						}
						await this.config.modifySave(cfg=>ignoreVsCodeDir(cfg));
						break;
					case "It's OK":
						await this.config.modifySave(cfg=>cfg.ignoreJsonUploadCaution = true);
						break;
					}
				});
			}
		});
		this.config.onLoadAfter(()=>{
			if (this.ftp.mainServer === null) throw Error('MainServer not found');
			return this.ftp.mainServer.init();
		});
		this.config.onInvalid(() => {
			this.attachOpenWatcher(false);
			this.attachWatcher(WatcherMode.CONFIG);
		});
		this.config.onNotFound(() => {
			this.ftp.onNotFoundConfig();
			this.attachOpenWatcher(false);
			this.attachWatcher(WatcherMode.NONE);
		});
		
		this.config.path.exists().then(exists=>{
			if (exists)
			{
				this.attachWatcher(WatcherMode.CONFIG);
				this.config.load();
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
		workFunc: (task:Task, path: File) => Promise<any>, 
		workName: string,
		autoSync: boolean): Promise<void>
	{
		try
		{
			if (path.fsPath == this.config.path.fsPath) {
				// #2. 와처가 바로 이전에 생성한 설정 파일에 반응하는 상황을 우회
				if (testInitTimeBiasForVSBug())
				{
					if (workName === 'upload') return;
				}

				this.logger.show();
				this.config.load();
				if (this.watcherMode === WatcherMode.CONFIG) return;
			}
			if (!autoSync) return;
			if (this.config.checkIgnorePath(path)) return;
			if (!path.in(this.config.basePath)) return;
			await this.scheduler.taskMust(
				workName+' '+this.config.workpath(path), 
				task => workFunc(task, path)
			);
		}
		catch (err) {
			processError(this.logger, err);
		}
	}

	attachOpenWatcher(mode: boolean): void {
		if (this.openWatcherMode === mode) return;
		this.openWatcherMode = mode;
		if (mode) {
			this.openWatcher = workspace.onDidOpenTextDocument(e => {
				try {
					const path = new File(e.uri.fsPath);
					var workspace:Workspace;
					try
					{
						workspace = Workspace.fromFile(path);
					}
					catch (err)
					{
						return;
					}
					const config = workspace.query(Config);
					const scheduler = workspace.query(Scheduler);
					const logger = workspace.query(Logger);
	
					if (!config.autoDownload) return;
					if (config.checkIgnorePath(path)) return;
					if (!path.in(this.config.basePath)) return;
					scheduler.taskMust(
						'download '+config.workpath(path),
						task => this.ftp.targetServer.ftpDownloadWithCheck(path, task))
						.catch(err=>processError(this.logger, err)
					);
				}
				catch (err) {
					processError(this.logger, err);
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
		const workspace = Workspace.fromFile(path);
		const config = workspace.query(Config);

		this.processWatcher(path, 
			(task, path)=>this.ftp.targetServer.ftpUpload(
				path, task, {ignoreNotExistFile: true, cancelWhenLatest: true}
			), 
			'upload', !!config.autoUpload
		);
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

		this.watcher = workspace.createFileSystemWatcher(watcherPath);

		this.watcher.onDidChange(uri => {
			this.logger.verbose('watcher.onDidChange: '+uri.fsPath);
			this.watcherQueue = this.watcherQueue.then(()=>{
				const path = new File(uri.fsPath);
				return this.processWatcher(path, 
					(task, path) => this.ftp.targetServer.ftpUpload(
						path, task, {
							ignoreNotExistFile: true, 
							cancelWhenLatest:true, 
							whenRemoteModed: this.config.ignoreRemoteModification? 'upload' : 'diff'
						}
					),
					'upload',
					!!this.config.autoUpload);
			}).catch(err=>this.logger.error(err));
		});
		this.watcher.onDidCreate(uri => {
			const path = new File(uri.fsPath);
			const workspace = Workspace.fromFile(path);
			const logger = workspace.query(Logger);
			logger.verbose('watcher.onDidCreate: '+uri.fsPath);
			this.watcherQueue = this.watcherQueue.then(()=>{
				return this.uploadCascade(path);
			}).catch(err=>logger.error(err));
		});
		this.watcher.onDidDelete(uri => {
			const path = new File(uri.fsPath);
			const workspace = Workspace.fromFile(path);
			const logger = workspace.query(Logger);
			const config = workspace.query(Config);
			logger.verbose('watcher.onDidDelete: '+uri.fsPath);
			this.watcherQueue = this.watcherQueue.then(()=>{
				return this.processWatcher(path, 
					(task, path)=>this.ftp.targetServer.ftpDelete(path, task), 
					'remove',
					!!config.autoDelete);
			}).catch(err=>logger.error(err));
		});
	}

}
