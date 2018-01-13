import * as log from './util/log';
import * as fs from './util/fs';
import * as work from './util/work';
import * as f from './util/filesystem';
import * as util from './util/util';
import * as vsutil from './util/vsutil';
import * as ftp from './ftp';
import * as cfg from './config';

export interface BatchOptions
{
	doNotRefresh?:boolean;
	doNotMakeDirectory?:boolean;
	ignoreNotExistFile?:boolean;
}

function testLatest(file:f.State|null, localStat:fs.Stats):boolean
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

class FtpFileSystem extends f.FileSystem
{
	refreshed:Map<string, RefreshedData> = new Map;

	private readonly logger:log.Logger;
	private readonly config:cfg.Config;
	private readonly ftp:ftp.FtpManager;

	constructor(public readonly workspace:fs.Workspace)
	{
		super();

		this.logger = workspace.query(log.Logger);
		this.config = workspace.query(cfg.Config);
		this.ftp = workspace.query(ftp.FtpManager);
	}


	private async _getUpdatedFileInDir(cmp:f.Directory|null, path:fs.Path, list:{[key:string]:fs.Stats}):Promise<void>
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
	
	private async _getUpdatedFile(cmp:f.State|null, path:fs.Path, list:{[key:string]:fs.Stats}):Promise<void>
	{
		if (this.config.checkIgnorePath(path)) return;
		try
		{
			const st = await path.lstat();
			if (st.isDirectory()) await this._getUpdatedFileInDir(cmp instanceof f.Directory ? cmp : null, path, list);
			if (testLatest(cmp, st)) return;
			list[path.workpath()] = st;
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

	delete(path:string):void
	{
		const dir = this.get(path);
		if (dir) this._deletedir(dir, path);
		super.delete(path);
	}
	
	async ftpDelete(task:work.Task, path:fs.Path, options?:BatchOptions):Promise<void>
	{
		const that = this;
		const workpath = path.workpath();

		async function deleteTest(file:f.State):Promise<void>
		{
			if (file instanceof f.Directory) await this.ftp.rmdir(task, path);
			else await this.ftp.remove(task, path);
			that.delete(workpath);
		}

		var file:f.State|null = this.get(workpath);
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

	async ftpUpload(task:work.Task, path:fs.Path, options?:BatchOptions):Promise<UploadReport>
	{
		const workpath = path.workpath();
		const report = new UploadReport;
	
		const that = this;
		var stats:fs.Stats;
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

				const dir = that.mkdir(workpath);
				dir.lmtimeWithThreshold = dir.lmtime = +stats.mtime;
				report.file = dir;
				return report;
			}
			else
			{
				that.refreshed.delete(workpath);
				that.refreshed.delete(path.parent().workpath());
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

				const file = that.create(workpath);
				file.lmtimeWithThreshold = file.lmtime = +stats.mtime;
				file.size = stats.size;
				report.file = file;
				return report;
			}
		}

		const filedir = this.get(path.parent().workpath());
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
		if (!this.config.options.autoDownload) return await next();

		const oldtype = oldfile.type;
		const oldsize = oldfile.size;
		const ftpstats = await this.ftpStat(task, path, options);

		if (ftpstats.type == oldtype &&  oldsize === ftpstats.size) return await next();

		const selected = await this.logger.errorConfirm(`${path}: Remote file modified detected.`, "Upload anyway", "Download");
		if (selected)
		{
			if (selected !== "Download") return await next();
			await this.ftpDownload(task, path);
		}
		report.file = oldfile;
		return report;
	}

	async ftpDownload(task:work.Task, path:fs.Path, options?:BatchOptions):Promise<void>
	{
		const workpath = path.workpath();
		var file:f.State|null = this.get(workpath);
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

	async ftpDownloadWithCheck(task:work.Task, path:fs.Path):Promise<void>
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
			if (this.config.options.autoUpload)
			{
				await this.ftpUpload(task, path);
			}
			return;
		}

		if (file instanceof f.File && stats.size === file.size) return;
		if (file instanceof f.Directory) await path.mkdir();
		else await this.ftp.download(task, path, path.workpath());
		stats = await path.stat();
		file.lmtime = +stats.mtime;
		file.lmtimeWithThreshold = file.lmtime + 1000;
	}

	async ftpStat(task:work.Task, path:fs.Path, options?:BatchOptions):Promise<f.State>
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
			const selected = await this.logger.errorConfirm(`remotePath(${this.config.options.remotePath}) does not exsisted", "Create Directory`);
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

	ftpList(task:work.Task, path:fs.Path, options?:BatchOptions):Promise<f.Directory>
	{
		const workpath = path.workpath();
		const latest = this.refreshed.get(workpath);
		if (latest)
		{
			if (options && options.doNotRefresh) return latest;
			const refreshTime = this.config.options.autoDownloadRefreshTime ? this.config.options.autoDownloadRefreshTime : 1000;
			if (latest.accessTime + refreshTime > Date.now()) return latest;
		}
		const deferred = new RefreshedData;
		this.refreshed.set(workpath, deferred);

		return (async()=>{
			await this.ftp.init(task);

			try
			{
				const ftpfiles = await this.ftp.list(task, workpath);
				const dir = this.refresh(workpath, ftpfiles);
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

	syncTestUpload(task:work.Task, path:fs.Path):Promise<TaskList>
	{
		const output = {};
		const list = {};
		return this._getUpdatedFile(this.root, path, list)
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
		
	async _listNotExists(task:work.Task, path:fs.Path, list:TaskList, download:boolean):Promise<void>
	{
		if (this.config.checkIgnorePath(path)) return;
		const that = this;
		const command = download ? "download" : "delete"; 
		
		var fslist:fs.Path[];
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

			const dirlist:fs.Path[] = [];
			for(const p in dir.files)
			{
				switch(p)
				{
				case '': case '.': case '..': break;
				default:
					const fullPath = path.child(p);
					if (this.config.checkIgnorePath(fullPath)) continue;
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
					list[path.child(p).workpath()] = command;
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

	syncTestNotExists(task:work.Task, path:fs.Path, download:boolean):Promise<TaskList>
	{
		const list:TaskList = {};
		return this._listNotExists(task, path, list, download)
		.then(() => list);
	}

	async _refeshForce(task:work.Task, path:fs.Path):Promise<void>
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
}


export class FtpSyncManager implements fs.WorkspaceItem
{
	private readonly logger:log.Logger;
	private readonly config:cfg.Config;
	private readonly vfs:FtpFileSystem;
	private syncDataPath:fs.Path|undefined;

	constructor(public readonly workspace:fs.Workspace)
	{
		this.logger = workspace.query(log.Logger);
		this.config = workspace.query(cfg.Config);
		this.vfs = new FtpFileSystem(workspace);
	}

	dispose():void
	{
		this.saveSync();
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
				case 'upload': await this.vfs.ftpUpload(task, path, options); break;
				case 'download': await this.vfs.ftpDownload(task, path, options); break;
				case 'delete': await this.vfs.ftpDelete(task, path, options); break;
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

	public upload(task:work.Task, path:fs.Path, options?:BatchOptions):Promise<UploadReport>
	{
		return this.vfs.ftpUpload(task, path, options);
	}

	public download(task:work.Task, path:fs.Path, doNotRefresh?:boolean):Promise<void>
	{
		return this.vfs.ftpDownload(task, path, {doNotRefresh});
	}

	public downloadWithCheck(task:work.Task, path:fs.Path):Promise<void>
	{
		return this.vfs.ftpDownloadWithCheck(task, path);
	}

	public syncTestClean(task:work.Task):Promise<TaskList>
	{
		return this.vfs.syncTestNotExists(task, this.workspace, false);
	}

	public syncTestUpload(task:work.Task, path:fs.Path):Promise<TaskList>
	{
		return this.vfs.syncTestUpload(task, path);
	}

	public syncTestDownload(task:work.Task, path:fs.Path):Promise<TaskList>
	{
		return this.vfs.syncTestNotExists(task, path, true);
	}

	public saveSync():void
	{
		if(!this.syncDataPath) return;
		if (this.config.state !== cfg.State.LOADED) return;
		if (!this.config.options.createSyncCache) return;
		this.workspace.child('.vscode').mkdir();
		this.syncDataPath.createSync(JSON.stringify(this.vfs.serialize(), null, 4));
	}

	public async load():Promise<void>
	{
		try
		{
			const config = this.config.options;
			this.syncDataPath = this.workspace.child(`.vscode/ftp-kr.sync.${config.protocol}.${config.host}.${config.remotePath.replace(/\//g, ".")}.json`);
		
			try
			{
				const data = await this.syncDataPath.open();
				const obj = util.parseJson(data);
				if (obj.version === 1)
				{
					this.vfs.deserialize(obj);
				}
				this.vfs.refreshed.clear();
			}
			catch(err)
			{
				this.vfs.reset();
				this.vfs.refreshed.clear();
				if (err === work.CANCELLED) throw err;
			}
		}
		catch(nerr)
		{
			if (nerr === work.CANCELLED) throw nerr;
			this.logger.error(nerr);
		}
	}

	public refreshForce(task:work.Task):Promise<void>
	{
		return this.vfs.ftpRefreshForce(task);
	}

	public async list(task:work.Task, path:fs.Path):Promise<void>
	{
		const dir = await this.vfs.ftpList(task, path);
		const pick = new vsutil.QuickPick;
		for(const filename in dir.files)
		{
			switch(filename)
			{
			case '': case '.': continue;
			case '..':
				if(path.workpath() === '') continue;
				pick.item('[DIR]\t..', ()=>this.list(task, path.parent()));
				continue;
			}
			const file = dir.files[filename];
			const npath = path.child(filename);
			
			switch (file.type)
			{
			case '-':
				pick.item('[FILE]\t' + file.name, ()=>{
					pick.clear();
					pick.item('Download '+file.name, ()=>this.download(task, npath));
					pick.item('Upload '+file.name, ()=>this.upload(task, npath));
					pick.item('Delete '+file.name, ()=>this.remove(task, npath));
					pick.oncancel = ()=>this.list(task, path);
					pick.open();
				});
				break;
			case 'd':
				pick.item('[DIR]\t' + file.name, ()=>this.list(task, npath));
				break;
			}
		}
		pick.items.sort((a,b)=>a.label.localeCompare(b.label));
		pick.open();
	}

	public init(task:work.Task):Promise<void>
	{
		return this.vfs.init(task);
	}

	public remove(task:work.Task, path:fs.Path):Promise<void>
	{
		return this.vfs.ftpDelete(task, path);
	}

}
