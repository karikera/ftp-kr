
import * as f from './util/filesystem';
import * as util from './util/util';
import {File, Stats} from './util/file';

import * as log from './vsutil/log';
import * as ws from './vsutil/ws';
import * as work from './vsutil/work';
import * as vsutil from './vsutil/vsutil';

import * as ftpmgr from './ftpmgr';
import * as cfg from './config';
import { DIRECTORY_NOT_FOUND } from './vsutil/fileinterface';
import { ServerConfig } from './util/fileinfo';
import { ftp_path } from './util/ftp_path';

export interface BatchOptions
{
	doNotRefresh?:boolean;
	doNotMakeDirectory?:boolean;
	ignoreNotExistFile?:boolean;
}

function testLatest(file:f.State|undefined, localStat:Stats):boolean
{
    if (!file) return false;
    switch(file.type)
    {
    case "-":
        if (!localStat.isFile()) return false;
		if (file instanceof f.FileCommon)
		{
    		if (localStat.size !== file.size) return false;
		}
        break;
    case "d":
        if (!localStat.isDirectory()) return false;
        break;
    case "l":
        if (!localStat.isSymbolicLink()) return false;
        break;
    }
    return true;
}


class RefreshedData extends util.Deferred<f.Directory>
{
	accessTime:number = new Date().valueOf();

	constructor()
	{
		super();
	}
}

export class UploadReport
{
	directoryIgnored:boolean = false;
	latestIgnored:boolean = false;
	noFileIgnored:boolean = false;
	file:f.State | undefined = undefined;
}

export interface TaskList
{
	[key:string]:string;
}

export class FtpCacher implements ws.WorkspaceItem
{
	private readonly fs:f.FileSystem = new f.FileSystem;
	private readonly refreshed:Map<string, RefreshedData> = new Map;
	private readonly config:ServerConfig;
	private readonly mainConfig:cfg.Config;
	private readonly logger:log.Logger;
	private readonly ftpmgr:ftpmgr.FtpManager;
	
	constructor(public readonly workspace:ws.Workspace, config?:ServerConfig)
	{
		this.mainConfig = workspace.query(cfg.Config);
		this.config = config || this.mainConfig;
		this.ftpmgr = new ftpmgr.FtpManager(workspace, this.config);
		this.logger = workspace.query(log.Logger);
	}

	public dispose():void
	{
		this.ftpmgr.destroy();
	}

	public destroy():void
	{
		this.ftpmgr.destroy();
	}

	public ftppath(path:File):string
	{
		return ftp_path.normalize(this.config.remotePath + '/' + this.mainConfig.workpath(path));
	}

	public fromFtpPath(ftppath:string):File
	{
		ftppath = ftp_path.normalize(ftppath);
		const remotePath = this.mainConfig.remotePath || '.';
		if (remotePath === '.')
		{
			if (ftppath === '..' || ftppath.startsWith('/') || ftppath.startsWith('../')) throw Error(`${ftppath} is not in remotePath`);
			return this.mainConfig.basePath.child(ftppath);
		}
		if (ftppath === remotePath) return this.mainConfig.basePath;
		if (!ftppath.startsWith(remotePath+'/')) throw Error(`${ftppath} is not in remotePath`);
		return this.mainConfig.basePath.child(ftppath.substr(remotePath.length+1));
	}

	public async ftpDelete(task:work.Task, path:File, options?:BatchOptions):Promise<void>
	{
		const ftppath = this.ftppath(path);

		const deleteTest = async(file:f.State):Promise<void>=>{
			if (file instanceof f.Directory) await this.ftpmgr.rmdir(task, ftppath);
			else await this.ftpmgr.remove(task, ftppath);
			this._fsDelete(ftppath);
		}

		var file:f.State|undefined = this.fs.get(ftppath);
		if (file)
		{
			try
			{
				return await deleteTest(file);
			}
			catch(err)
			{
			}
		}
		file = await this.ftpStat(task, ftppath, options);
		if (!file) return;
		await deleteTest(file);
	}

	public async ftpUpload(task:work.Task, path:File, options?:BatchOptions):Promise<UploadReport>
	{
		const ftppath = this.ftppath(path);
		const report = new UploadReport;
	
		var stats:Stats;
		var oldfile:f.State|undefined = undefined;
		
		try
		{
			stats = await path.stat();
		}
		catch(e)
		{
			if (e.code === 'ENOENT' && options && options.ignoreNotExistFile)
			{
				report.noFileIgnored = true;
				return report;
			}
			throw e;
		}
		
		const next = async ():Promise<UploadReport>=>{
			if (stats.isDirectory())
			{
				if (options && options.doNotMakeDirectory)
				{
					report.directoryIgnored = true;
					return report;
				}

				if (oldfile)
				{
					if (oldfile instanceof f.Directory)
					{
						oldfile.lmtimeWithThreshold = oldfile.lmtime = +stats.mtime;
						report.file = oldfile;
						return report;
					}
					await this.ftpDelete(task, path).then(() => this.ftpmgr.mkdir(task, ftppath));
				}
				else
				{
					await this.ftpmgr.mkdir(task, ftppath);
				}

				const dir = this.fs.mkdir(ftppath);
				dir.lmtimeWithThreshold = dir.lmtime = +stats.mtime;
				report.file = dir;
				return report;
			}
			else
			{
				this.refreshed.delete(ftppath);
				this.refreshed.delete(this.ftppath(path.parent()));
				try
				{
					await this.ftpmgr.upload(task, ftppath, path);
				}
				catch(e)
				{
					if (e.code === 'ENOENT' && options && options.ignoreNotExistFile)
					{
						report.noFileIgnored = true;
						return report;
					}
					throw e;
				}

				const file = this.fs.create(ftppath);
				file.lmtimeWithThreshold = file.lmtime = +stats.mtime;
				file.size = stats.size;
				report.file = file;
				return report;
			}
		};

		const filedir = this.fs.get(this.ftppath(path.parent()));
		if (!filedir) return await next();
		oldfile = filedir.files[path.basename()];
		if (!oldfile) return await next();
		if (+stats.mtime <= oldfile.lmtimeWithThreshold)
		{
			report.latestIgnored = true;
			report.file = oldfile;
			return report;
		}
		if (+stats.mtime === oldfile.lmtime)
		{
			report.latestIgnored = true;
			report.file = oldfile;
			return report;
		}
		return await next();
	}

	public async ftpDownload(task:work.Task, path:File, options?:BatchOptions):Promise<void>
	{
		const ftppath = this.ftppath(path);
		var file:f.State|undefined = this.fs.get(ftppath);
		if (!file)
		{
			file = await this.ftpStat(task, ftppath, options);
			if (!file)
			{
				this.logger.error(`${ftppath} not found in remote`);
				return Promise.resolve();
			}
		}

		if (file instanceof f.Directory) await path.mkdirp();
		else await this.ftpmgr.download(task, path, ftppath);
		const stats = await path.stat();
		file.lmtime = +stats.mtime;
		file.lmtimeWithThreshold = file.lmtime + 1000;
	}

	public async ftpDownloadWithCheck(task:work.Task, path:File):Promise<void>
	{
		const ftppath = this.ftppath(path);

		try
		{
			var stats = await path.stat();
		}
		catch(e)
		{
			if (e.code === 'ENOENT') return; // vscode open "%s.git" file, why?
			throw e;
		}
		const file = await this.ftpStat(task, ftppath);
		if (!file || (file.lmtime < +stats.mtime))
		{
			if (this.mainConfig === this.config && this.mainConfig.autoUpload)
			{
				await this.ftpUpload(task, path);
			}
			return;
		}

		if (file instanceof f.File && stats.size === file.size) return;
		if (file instanceof f.Directory) await path.mkdir();
		else
		{
			await this.ftpmgr.download(task, path, ftppath);
		}
		stats = await path.stat();
		file.lmtime = +stats.mtime;
		file.lmtimeWithThreshold = file.lmtime + 1000;
	}

	public async ftpStat(task:work.Task, ftppath:string, options?:BatchOptions):Promise<f.State|undefined>
	{
		const parent = ftp_path.dirname(ftppath);
		const dir = await this.ftpList(task, parent, options);
		return dir.files[ftp_path.basename(ftppath)];
	}

	public async ftpTargetStat(task:work.Task, linkfile:f.State):Promise<f.State|undefined>
	{
		for (;;)
		{
			const target = await this.ftpmgr.readlink(task, linkfile);
			const stats = await this.ftpStat(task, target);
			if (!stats) return undefined;
			linkfile = stats;
			if (linkfile.type !== 'l') return linkfile;
		}
	}

	public async init(task:work.Task):Promise<void>
	{
		await this.ftpList(task, this.mainConfig.remotePath || '.');
	}

	public ftpList(task:work.Task, ftppath:string, options?:BatchOptions):Promise<f.Directory>
	{
		const latest = this.refreshed.get(ftppath);
		if (latest)
		{
			if (options && options.doNotRefresh) return latest;
			if (this.mainConfig === this.config)
			{
				const refreshTime = this.mainConfig.refreshTime || this.mainConfig.autoDownloadRefreshTime || 1000;
				if (latest.accessTime + refreshTime > Date.now()) return latest;
			}
			else
			{
				return latest;
			}
		}
		const deferred = new RefreshedData;
		this.refreshed.set(ftppath, deferred);

		return (async()=>{
			await this.ftpmgr.init(task);

			try
			{
				const ftpfiles = await this.ftpmgr.list(task, ftppath);
				const dir = this.fs.refresh(ftppath, ftpfiles);
				deferred.resolve(dir);
				return dir;
			}
			catch(err)
			{
				deferred.catch(() => {});
				deferred.reject(err);
				if (this.refreshed.get(ftppath) === deferred)
				{
					this.refreshed.delete(ftppath);
				}
				throw err;
			}
		})();
	}

	public ftpRefreshForce(task:work.Task):Promise<void>
	{
		this.refreshed.clear();
		return this._refeshForce(task, ftp_path.normalize(this.mainConfig.remotePath + '.'));
	}

	public async exec(task:work.Task, tasklist:TaskList, options?:BatchOptions):Promise<{tasks:TaskList, count:number}|null>
	{
		var errorCount = 0;
		const failedTasks:TaskList = {};

		for (const file in tasklist)
		{
			const exec = tasklist[file];
			const path = this.mainConfig.basePath.child(file);
			try
			{
				switch (exec)
				{
				case 'upload': await this.ftpUpload(task, path, options); break;
				case 'download': await this.ftpDownload(task, path, options); break;
				case 'delete': await this.ftpDelete(task, path, options); break;
				}
			}
			catch(err)
			{
				failedTasks[file] = exec;
				console.error(err);
				this.logger.message(err);
				errorCount ++;
			}
		}
		if (errorCount)
			return {tasks:failedTasks, count:errorCount};
		else return null;
	}

	public async uploadAll(task:work.Task, path: File): Promise<void>
	{
		const tasks = await this._syncTestUpload(task, path);
		await this._reserveSyncTask(task, tasks, 'Upload All', {doNotRefresh:true});
	}

	public async downloadAll(task:work.Task, path: File): Promise<void>
	{
		const tasks = await this._syncTestDownload(task, path)
		await this._reserveSyncTask(task, tasks, 'Download All', {doNotRefresh:true});
	}

	public async cleanAll(task:work.Task):Promise<void>
	{
		const tasks = await this._syncTestClean(task);
		return this._reserveSyncTask(task, tasks, 'ftpkr.Clean All', {doNotRefresh:true});
	}
	
	public async list(task:work.Task, path:File):Promise<void>
	{
		const ftppath = this.ftppath(path);
		const dir = await this.ftpList(task, ftppath);
		const pick = new vsutil.QuickPick;
		if (path.fsPath !== this.mainConfig.basePath.fsPath)
		{
			pick.item('Current Directory Action', ()=>{
				const pick = new vsutil.QuickPick;
				pick.item('Download Current Directory', ()=>this.downloadAll(task, path));
				pick.item('Upload Current Directory', ()=>this.uploadAll(task, path));
				pick.item('Delete Current Directory', ()=>this.ftpDelete(task, path));
				pick.oncancel = ()=>this.list(task, path);
				return pick.open();
			});
		}
		
		var files:f.State[] = [];
		var dirs:f.State[] = [];
		var links:f.State[] = [];

		for(const filename in dir.files)
		{
			switch(filename)
			{
			case '': case '.': continue;
			case '..':
				if(this.mainConfig.basePath.fsPath === path.fsPath) continue;
				pick.item('[DIR]\t..', ()=>this.list(task, path.parent()));
				continue;
			}
			const file = dir.files[filename];
			if (!file) continue;
			
			switch (file.type)
			{
			case 'l':
				links.push(file);
				break;
			case '-':
				files.push(file);
				break;
			case 'd':
				dirs.push(file);
				break;
			}
		}
		files = files.sort((a,b)=>a.name.localeCompare(b.name));
		links = links.sort((a,b)=>a.name.localeCompare(b.name));
		dirs = dirs.sort((a,b)=>a.name.localeCompare(b.name));

		for (const dir of dirs)
		{
			pick.item('[DIR]\t' + dir.name, ()=>this.list(task, path.child(dir.name)));
		}

		for (const link of links)
		{
			pick.item('[LINK]\t' + link.name, async()=>{
				const stats = await this.ftpTargetStat(task, link);
				if (!stats) return await this.list(task, path);
				switch (stats.type)
				{
				case 'd':
					return await this.list(task, path.child(link.name));
				case '-':
					const npath = path.child(stats.name);
					pick.clear();
					pick.item('Download '+stats.name, ()=>this.ftpDownload(task, npath));
					pick.item('Upload '+stats.name, ()=>this.ftpUpload(task, npath));
					pick.item('Delete '+stats.name, ()=>this.ftpDelete(task, npath));
					pick.oncancel = ()=>this.list(task, path);
					return pick.open();
				}
			});
		}

		for (const file of files)
		{
			pick.item('[FILE]\t' + file.name, ()=>{
				const npath = path.child(file.name);
				pick.clear();
				pick.item('Download '+file.name, ()=>this.ftpDownload(task, npath));
				pick.item('Upload '+file.name, ()=>this.ftpUpload(task, npath));
				pick.item('Delete '+file.name, ()=>this.ftpDelete(task, npath));
				pick.oncancel = ()=>this.list(task, path);
				return pick.open();
			});
		}
		
		await pick.open().catch(err=> {
			console.error(err);
			throw err;
		});
	}
	
	private async _syncTestUpload(task:work.Task, path:File):Promise<TaskList>
	{
		const list = {};
		await this._getUpdatedFile(this.fs.root, path, list)
		
		const output = {};
		for(const ftppath in list)
		{
			const path = this.fromFtpPath(ftppath);
			const st = list[ftppath];
			const file = await this.ftpStat(task, ftppath);
			if (!await testLatest(file, st))
			{
				output[ftppath] = "upload";
			}
		}
		return output;
	}

	private _syncTestDownload(task:work.Task, path:File):Promise<TaskList>
	{
		return this._syncTestNotExists(task, path, true);
	}

	private _syncTestClean(task:work.Task):Promise<TaskList>
	{
		return this._syncTestNotExists(task, this.mainConfig.basePath, false);
	}

	private _syncTestNotExists(task:work.Task, path:File, download:boolean):Promise<TaskList>
	{
		const list:TaskList = {};
		return this._listNotExists(task, path, list, download)
		.then(() => list);
	}

	private async _listNotExists(task:work.Task, path:File, list:TaskList, download:boolean):Promise<void>
	{
		if (this.mainConfig.checkIgnorePath(path)) return;
		const command = download ? "download" : "delete"; 
		
		var fslist:File[];
		try
		{
			fslist = await path.children();
		}
		catch (err)
		{
			if (!download) return;
			fslist = [];
		}

		try
		{
			const dir = await this.ftpList(task, this.ftppath(path));
			const targets = new Set<string>();

			const dirlist:File[] = [];
			for(const p in dir.files)
			{
				switch(p)
				{
				case '': case '.': case '..': continue;
				}
				const fullPath = path.child(p);
				if (this.mainConfig.checkIgnorePath(fullPath)) continue;
				var file = dir.files[p];
				if (!file) continue;
				if (file.type === 'l')
				{
					if (!this.mainConfig.followLink) continue;
					file = await this.ftpTargetStat(task, file);
					if (!file) continue;
				}
				targets.add(p);
				if (file.type === 'd')
				{
					dirlist.push(fullPath);
				}
			}
			for(const file of fslist)
			{
				targets.delete(file.basename());
			}

			const flushList = ()=>{
				for (const p of targets)
				{
					list[this.ftppath(path.child(p))] = command;
				}
			};
			const processChild = async()=>{
				for(const child of dirlist)
				{
					await this._listNotExists(task, child, list, download);
				}
			};
			if (download)
			{
				flushList();
				await processChild();
			}
			else // delete
			{
				await processChild();
				flushList();
			}
		}
		catch(err)
		{
			throw err;
		}
	}

	private _reserveSyncTask(task:work.Task, tasks: TaskList, taskname: string, options:BatchOptions): Promise<void>
	{
		return this._reserveSyncTaskWith(task, tasks, taskname, options, () => vsutil.info("Review Operations to perform.", "OK"));
	}

	private async _reserveSyncTaskWith(task:work.Task, tasks: TaskList, taskname: string, options:BatchOptions, infocallback: () => Thenable<string|undefined>): Promise<void>
	{
		const taskFile = this.workspace.child(".vscode/ftp-kr.task.json");
		
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
				await taskFile.create(JSON.stringify(tasks, null, 1));
				await vsutil.open(taskFile);
				const res = await infocallback();
				if (res !== "OK" && res !== "Retry") 
				{
					taskFile.unlink();
					return;
				}
				const editor = await vsutil.open(taskFile);
				if (editor) await editor.document.save();
				const startTime = Date.now();
				const data = await taskFile.json();
				await taskFile.unlink();
				const failed = await this.exec(task, data, options);
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
				await taskFile.unlink();
			}
			catch(e)
			{
			}
			throw err;
		}
	}

	private async _getUpdatedFileInDir(cmp:f.Directory|undefined, path:File, list:{[key:string]:Stats}):Promise<void>
	{
		const files = await path.children();
		for (const child of files)
		{
			var childfile:f.State|undefined;
			if (cmp)
			{
				const file = cmp.files[child.basename()];
				if (file) childfile = file;
			}
			await this._getUpdatedFile(childfile, child, list);
		}
	}
	
	private async _getUpdatedFile(cmp:f.State|undefined, path:File, list:{[key:string]:Stats}):Promise<void>
	{
		if (this.mainConfig.checkIgnorePath(path)) return;
		try
		{
			const st = await path.lstat();
			if (st.isDirectory()) await this._getUpdatedFileInDir(cmp instanceof f.Directory ? cmp : undefined, path, list);
			if (testLatest(cmp, st)) return;
			list[this.ftppath(path)] = st;
		}
		catch(err)
		{
		}
	}

	private _deletedir(dir:f.Directory, path:string):void
	{
		if (!this.refreshed.delete(path)) return;
		for(const filename in dir.files)
		{
			const childdir = dir.files[filename];
			if (!(childdir instanceof f.Directory)) continue;
			this._deletedir(childdir, path+'/'+filename);
		}
	}

	private _fsDelete(path:string):void
	{
		const dir = this.fs.get(path);
		if (dir) this._deletedir(dir, path);
		this.fs.delete(path);
	}
	
	private async _refeshForce(task:work.Task, ftppath:string):Promise<void>
	{
		const dir = await this.ftpList(task, ftppath);
		for(const p in dir.files)
		{
			switch(p)
			{
			case '': case '.': case '..': break;
			default:
				if (dir.files[p] instanceof f.Directory)
				{
					await this._refeshForce(task, ftp_path.normalize(ftppath + '/' + p));
				}
				break;
			}
		}
	}
}

export class FtpSyncManager implements ws.WorkspaceItem
{
	private readonly logger:log.Logger;
	private readonly config:cfg.Config;
	private readonly ftpcacher:FtpCacher;
	
	constructor(public readonly workspace:ws.Workspace)
	{
		this.logger = workspace.query(log.Logger);
		this.config = workspace.query(cfg.Config);
		this.ftpcacher = workspace.query(FtpCacher);
	}

	dispose():void
	{
	}

	getServer(config:ServerConfig):FtpCacher
	{
		if (config === this.config) return this.ftpcacher;
		return new FtpCacher(this.workspace, config);
	}

	async selectServer():Promise<FtpCacher|undefined>
	{
		var selected:FtpCacher|undefined = undefined;
		const pick = new vsutil.QuickPick;
		pick.item(this.config.name || 'Main Server', ()=>{ selected = this.ftpcacher;});
		for (const server of this.config.getAltServers())
		{
			const name = server.name || server.host;
			if (!name) continue;
			pick.item(name, ()=>{ selected = new FtpCacher(this.workspace, server); });
		}
		if (pick.items.length === 1)
		{
			pick.items[0].onselect();
		}
		else
		{
			await pick.open();
		}
		return selected;
	}

	public reconnect(task:work.Task):Promise<void>
	{
		this.ftpcacher.destroy();
		return this.ftpcacher.init(task);
	}

	public upload(task:work.Task, path:File, options?:BatchOptions):Promise<UploadReport>
	{
		return this.ftpcacher.ftpUpload(task, path, options);
	}

	public download(task:work.Task, path:File, doNotRefresh?:boolean):Promise<void>
	{
		return this.ftpcacher.ftpDownload(task, path, {doNotRefresh});
	}

	public downloadWithCheck(task:work.Task, path:File):Promise<void>
	{
		return this.ftpcacher.ftpDownloadWithCheck(task, path);
	}

	public refreshForce(task:work.Task):Promise<void>
	{
		return this.ftpcacher.ftpRefreshForce(task);
	}

	public init(task:work.Task):Promise<void>
	{
		return this.ftpcacher.init(task);
	}

	public remove(task:work.Task, path:File):Promise<void>
	{
		return this.ftpcacher.ftpDelete(task, path);
	}

	public async uploadAll(task:work.Task, path:File): Promise<void>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return;
		await selected.uploadAll(task, path);
		if (selected !== this.ftpcacher) selected.destroy();
	}

	public async downloadAll(task:work.Task, path:File): Promise<void>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return;
		await selected.downloadAll(task, path);
		if (selected !== this.ftpcacher) selected.destroy();
	}

	public async cleanAll(task:work.Task)
	{
		const selected = await this.selectServer();
		if (selected === undefined) return;
		await selected.cleanAll(task);
		if (selected !== this.ftpcacher) selected.destroy();
	}
	
	public async list(task:work.Task, path:File):Promise<void>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return;
		await selected.list(task, path);
		if (selected !== this.ftpcacher) selected.destroy();
	}	
}
