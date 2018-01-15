
import * as f from './util/filesystem';
import * as util from './util/util';
import {default as File, Stats} from './util/file';

import * as log from './vsutil/log';
import * as ws from './vsutil/ws';
import * as work from './vsutil/work';
import * as vsutil from './vsutil/vsutil';

import * as ftp from './ftp';
import * as cfg from './config';

export interface BatchOptions
{
	doNotRefresh?:boolean;
	doNotMakeDirectory?:boolean;
	ignoreNotExistFile?:boolean;
}

const TASK_FILE_PATH = File.parse("/.vscode/ftp-kr.task.json");

function testLatest(file:f.State|null, localStat:Stats):boolean
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
	file:f.State | null = null;
}

export interface TaskList
{
	[key:string]:string;
}

class FtpCacher
{
	private readonly fs:f.FileSystem = new f.FileSystem;
	private readonly refreshed:Map<string, RefreshedData> = new Map;
	private readonly mainConfig:cfg.Config;
	private readonly logger:log.Logger;
	private readonly ftp:ftp.FtpManager;
	
	constructor(public readonly workspace:ws.Workspace, private readonly config:cfg.ServerConfig)
	{
		this.ftp = new ftp.FtpManager(workspace, config);
		this.logger = workspace.query(log.Logger);
		this.mainConfig = workspace.query(cfg.Config);
	}

	private async _getUpdatedFileInDir(cmp:f.Directory|null, path:File, list:{[key:string]:Stats}):Promise<void>
	{
		const files = await path.children();
		for (const child of files)
		{
			var childfile:f.State|null = null;
			if (cmp)
			{
				const file = cmp.files[child.basename()];
				if (file) childfile = file;
			}
			await this._getUpdatedFile(childfile, child, list);
		}
	}
	
	private async _getUpdatedFile(cmp:f.State|null, path:File, list:{[key:string]:Stats}):Promise<void>
	{
		if (this.mainConfig.checkIgnorePath(path)) return;
		try
		{
			const st = await path.lstat();
			if (st.isDirectory()) await this._getUpdatedFileInDir(cmp instanceof f.Directory ? cmp : null, path, list);
			if (testLatest(cmp, st)) return;
			list[ws.workpath(path)] = st;
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

	public destroy():void
	{
		this.ftp.destroy();
	}

	delete(path:string):void
	{
		const dir = this.fs.get(path);
		if (dir) this._deletedir(dir, path);
		this.fs.delete(path);
	}
	
	async ftpDelete(task:work.Task, path:File, options?:BatchOptions):Promise<void>
	{
		const that = this;
		const workpath = ws.workpath(path);

		async function deleteTest(file:f.State):Promise<void>
		{
			if (file instanceof f.Directory) await that.ftp.rmdir(task, workpath);
			else await that.ftp.remove(task, workpath);
			that.delete(workpath);
		}

		var file:f.State|null = this.fs.get(workpath);
		if (file !== null)
		{
			try
			{
				return await deleteTest(file);
			}
			catch(err)
			{
			}
		}
		file = await that.ftpStat(task, path, options);
		if (file === null) return;
		await deleteTest(file);
	}

	async ftpUpload(task:work.Task, path:File, options?:BatchOptions):Promise<UploadReport>
	{
		const workpath = ws.workpath(path);
		const report = new UploadReport;
	
		const that = this;
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
		
		async function next():Promise<UploadReport>
		{
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
					await that.ftpDelete(task, path).then(() => that.ftp.mkdir(task, workpath));
				}
				else
				{
					await that.ftp.mkdir(task, workpath);
				}

				const dir = that.fs.mkdir(workpath);
				dir.lmtimeWithThreshold = dir.lmtime = +stats.mtime;
				report.file = dir;
				return report;
			}
			else
			{
				that.refreshed.delete(workpath);
				that.refreshed.delete(ws.workpath(path.parent()));
				try
				{
					await that.ftp.upload(task, workpath, path);
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

				const file = that.fs.create(workpath);
				file.lmtimeWithThreshold = file.lmtime = +stats.mtime;
				file.size = stats.size;
				report.file = file;
				return report;
			}
		}

		const filedir = this.fs.get(ws.workpath(path.parent()));
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
		if (this.mainConfig === this.config && !this.mainConfig.autoDownload)
		{
			const oldtype = oldfile.type;
			const oldsize = oldfile.size;
			const ftpstats = await this.ftpStat(task, path, options);
	
			if (ftpstats.type == oldtype && oldsize === ftpstats.size) return await next();
	
			const selected = await this.logger.errorConfirm(`${path}: Remote file modified detected.`, "Upload anyway", "Download");
			if (selected)
			{
				if (selected !== "Download") return await next();
				await this.ftpDownload(task, path);
			}
			report.file = oldfile;
			return report;
		}
		else
		{
			return await next();
		}
	}

	async ftpDownload(task:work.Task, path:File, options?:BatchOptions):Promise<void>
	{
		const workpath = ws.workpath(path);
		var file:f.State|null = this.fs.get(workpath);
		if (!file)
		{
			file = await this.ftpStat(task, path, options);
			if (!file)
			{
				this.logger.error(`${path} not found in remote`);
				return Promise.resolve();
			}
		}

		if (file instanceof f.Directory) await path.mkdir();
		else await this.ftp.download(task, path, workpath);
		const stats = await path.stat();
		file.lmtime = +stats.mtime;
		file.lmtimeWithThreshold = file.lmtime + 1000;
	}

	async ftpDownloadWithCheck(task:work.Task, path:File):Promise<void>
	{
		try
		{
			var stats = await path.stat();
		}
		catch(e)
		{
			if (e.code === 'ENOENT') return; // vscode open "%s.git" file, why?
			throw e;
		}
		const file = await this.ftpStat(task, path);
		if (!file)
		{
			if (this.mainConfig === this.config && this.mainConfig.autoUpload)
			{
				await this.ftpUpload(task, path);
			}
			return;
		}

		if (file instanceof f.File && stats.size === file.size) return;
		if (file instanceof f.Directory) await path.mkdir();
		else await this.ftp.download(task, path, ws.workpath(path));
		stats = await path.stat();
		file.lmtime = +stats.mtime;
		file.lmtimeWithThreshold = file.lmtime + 1000;
	}

	async ftpStat(task:work.Task, path:File, options?:BatchOptions):Promise<f.State>
	{
		const dir = await this.ftpList(task, path.parent(), options);
		return dir.files[path.basename()];
	}

	async init(task:work.Task):Promise<void>
	{
		try
		{
			await this.ftpList(task, this.workspace);
		}
		catch(e)
		{
			if (e.ftpError !== ftp.DIRECTORY_NOT_FOUND) 
			{
				throw e;
			}
			// ftp.list function suppress not found error
			// so..   these codes are useless
			const selected = await this.logger.errorConfirm(`remotePath(${this.config.remotePath}) does not exsisted", "Create Directory`);
			task.checkCanceled();
			if (!selected)
			{
				e.suppress = true;
				throw e;
			}
			await this.ftp.mkdir(task, '');
			task.checkCanceled();

			await this.ftpList(task, this.workspace);
		}
	}

	ftpList(task:work.Task, path:File, options?:BatchOptions):Promise<f.Directory>
	{
		const workpath = ws.workpath(path);
		const latest = this.refreshed.get(workpath);
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
		this.refreshed.set(workpath, deferred);

		return (async()=>{
			await this.ftp.init(task);

			try
			{
				const ftpfiles = await this.ftp.list(task, workpath);
				const dir = this.fs.refresh(workpath, ftpfiles);
				deferred.resolve(dir);
				return dir;
			}
			catch(err)
			{
				deferred.catch(() => {});
				deferred.reject(err);
				if (this.refreshed.get(workpath) === deferred)
				{
					this.refreshed.delete(workpath);
				}
				throw err;
			}
		})();
	}

	syncTestUpload(task:work.Task, path:File):Promise<TaskList>
	{
		const output = {};
		const list = {};
		return this._getUpdatedFile(this.fs.root, path, list)
		.then(() => {
			let promise = Promise.resolve();
			for(const workpath in list)
			{
				const path = this.workspace.child(workpath);
				const st = list[workpath];
				promise = promise
				.then(() => this.ftpStat(task, path))
				.then((file) => testLatest(file, st))
				.then((res) => { if(!res) output[workpath] = "upload"; });
			}
			return promise;
		})
		.then(() => output);
	}
		
	async _listNotExists(task:work.Task, path:File, list:TaskList, download:boolean):Promise<void>
	{
		if (this.mainConfig.checkIgnorePath(path)) return;
		const that = this;
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
			const dir = await that.ftpList(task, path);
			const willDel = new Set<string>();

			const dirlist:File[] = [];
			for(const p in dir.files)
			{
				switch(p)
				{
				case '': case '.': case '..': break;
				default:
					const fullPath = path.child(p);
					if (this.mainConfig.checkIgnorePath(fullPath)) continue;
					willDel.add(p);
					if (dir.files[p] instanceof f.Directory)
					{
						dirlist.push(fullPath);
					}
					break;
				}
			}
			for(const file of fslist)
			{
				willDel.delete(file.basename());
			}

			function flushList():void
			{
				for (const p of willDel)
				{
					list[ws.workpath(path.child(p))] = command;
				}
			}
			async function processChild():Promise<void>
			{
				for(const child of dirlist)
				{
					await that._listNotExists(task, child, list, download);
				}
			}
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

	async _refeshForce(task:work.Task, path:File):Promise<void>
	{
		const dir = await this.ftpList(task, path);
		for(const p in dir.files)
		{
			switch(p)
			{
			case '': case '.': case '..': break;
			default:
				if (dir.files[p] instanceof f.Directory)
				{
					await this._refeshForce(task, path.child(p));
				}
				break;
			}
		}
	}
	
	ftpRefreshForce(task:work.Task):Promise<void>
	{
		this.refreshed.clear();
		return this._refeshForce(task, this.workspace);
	}

	
	public async exec(task:work.Task, tasklist:TaskList, options?:BatchOptions):Promise<{tasks:TaskList, count:number}|null>
	{
		var errorCount = 0;
		const failedTasks:TaskList = {};

		for (const file in tasklist)
		{
			const exec = tasklist[file];
			const path = this.workspace.child(file);
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
		const tasks = await this.syncTestUpload(task, path);
		await this.reserveSyncTask(task, tasks, 'Upload All', {doNotRefresh:true});
	}

	public async downloadAll(task:work.Task, path: File): Promise<void>
	{
		const tasks = await this.syncTestDownload(task, path)
		await this.reserveSyncTask(task, tasks, 'Download All', {doNotRefresh:true});
	}

	public async cleanAll(task:work.Task):Promise<void>
	{
		const tasks = await this.syncTestClean(task);
		return this.reserveSyncTask(task, tasks, 'ftpkr.Clean All', {doNotRefresh:true});
	}
	
	private syncTestDownload(task:work.Task, path:File):Promise<TaskList>
	{
		return this.syncTestNotExists(task, path, true);
	}

	public reserveSyncTask(task:work.Task, tasks: TaskList, taskname: string, options:BatchOptions): Promise<void>
	{
		return this.reserveSyncTaskWith(task, tasks, taskname, options, () => vsutil.info("Review Operations to perform.", "OK"));
	}

	public async reserveSyncTaskWith(task:work.Task, tasks: TaskList, taskname: string, options:BatchOptions, infocallback: () => Thenable<string|undefined>): Promise<void>
	{
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
				await TASK_FILE_PATH.unlink();
			}
			catch(e)
			{
			}
			throw err;
		}
	}

	private syncTestNotExists(task:work.Task, path:File, download:boolean):Promise<TaskList>
	{
		const list:TaskList = {};
		return this._listNotExists(task, path, list, download)
		.then(() => list);
	}

	private syncTestClean(task:work.Task):Promise<TaskList>
	{
		return this.syncTestNotExists(task, this.workspace, false);
	}

	public async list(task:work.Task, path:File):Promise<void>
	{
		const dir = await this.ftpList(task, path);
		const pick = new vsutil.QuickPick;
		if (path.fsPath !== this.workspace.fsPath)
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
		
		var files:string[] = [];
		var dirs:string[] = [];

		for(const filename in dir.files)
		{
			switch(filename)
			{
			case '': case '.': continue;
			case '..':
				if(ws.workpath(path) === '') continue;
				pick.item('[DIR]\t..', ()=>this.list(task, path.parent()));
				continue;
			}
			const file = dir.files[filename];
			
			switch (file.type)
			{
			case 'l':
			case '-':
				files.push(file.name);
				break;
			case 'd':
				dirs.push(file.name);
				break;
			}
		}
		files = files.sort((a,b)=>a.localeCompare(b));
		dirs = dirs.sort((a,b)=>a.localeCompare(b));

		for (const dir of dirs)
		{
			pick.item('[DIR]\t' + dir, ()=>this.list(task, path.child(dir)));
		}

		for (const file of files)
		{
			pick.item('[FILE]\t'+file, ()=>{
				const npath = path.child(file);
				pick.clear();
				pick.item('Download '+file, ()=>this.ftpDownload(task, npath));
				pick.item('Upload '+file, ()=>this.ftpUpload(task, npath));
				pick.item('Delete '+file, ()=>this.ftpDelete(task, npath));
				pick.oncancel = ()=>this.list(task, path);
				return pick.open();
			});
		}
		await pick.open();
	}
}


export class FtpSyncManager implements ws.WorkspaceItem
{
	private readonly logger:log.Logger;
	private readonly config:cfg.Config;
	private readonly ftp:FtpCacher;
	
	constructor(public readonly workspace:ws.Workspace)
	{
		this.logger = workspace.query(log.Logger);
		this.config = workspace.query(cfg.Config);
		this.ftp = new FtpCacher(workspace, this.config);
	}

	getServer(config:cfg.ServerConfig):FtpCacher
	{
		if (config === this.config) return this.ftp;
		return new FtpCacher(this.workspace, config);
	}

	async selectServer():Promise<FtpCacher|undefined>
	{
		var selected:FtpCacher | undefined = undefined;
		const pick = new vsutil.QuickPick;
		pick.item(this.config.name || 'Main Server', ()=>{ selected = this.ftp;});
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

	dispose():void
	{
		this.ftp.destroy();
	}

	public upload(task:work.Task, path:File, options?:BatchOptions):Promise<UploadReport>
	{
		return this.ftp.ftpUpload(task, path, options);
	}

	public download(task:work.Task, path:File, doNotRefresh?:boolean):Promise<void>
	{
		return this.ftp.ftpDownload(task, path, {doNotRefresh});
	}

	public downloadWithCheck(task:work.Task, path:File):Promise<void>
	{
		return this.ftp.ftpDownloadWithCheck(task, path);
	}

	public refreshForce(task:work.Task):Promise<void>
	{
		return this.ftp.ftpRefreshForce(task);
	}

	public init(task:work.Task):Promise<void>
	{
		return this.ftp.init(task);
	}

	public remove(task:work.Task, path:File):Promise<void>
	{
		return this.ftp.ftpDelete(task, path);
	}

	public async uploadAll(task:work.Task, path:File): Promise<void>
	{
		const ftp = await this.selectServer();
		if (ftp === undefined) return;
		await ftp.uploadAll(task, path);
		if (ftp !== this.ftp) ftp.destroy();
	}

	public async downloadAll(task:work.Task, path:File): Promise<void>
	{
		const ftp = await this.selectServer();
		if (ftp === undefined) return;
		await ftp.downloadAll(task, path);
		if (ftp !== this.ftp) ftp.destroy();
	}

	public async cleanAll(task:work.Task)
	{
		const ftp = await this.selectServer();
		if (ftp === undefined) return;
		await ftp.cleanAll(task);
		if (ftp !== this.ftp) ftp.destroy();
	}
	
	public async list(task:work.Task, path:File):Promise<void>
	{
		const ftp = await this.selectServer();
		if (ftp === undefined) return;
		await ftp.list(task, path);
		if (ftp !== this.ftp) ftp.destroy();
	}	
}
