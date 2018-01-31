
import { window, workspace } from 'vscode';

import { File, Stats } from './util/file';
import { ServerConfig } from './util/fileinfo';
import { ftp_path } from './util/ftp_path';
import { VFSState, FileSystem, VFSFile, VFSDirectory, VFSFileCommon } from './util/filesystem';
import { Deferred, isEmptyObject } from './util/util';

import { DIRECTORY_NOT_FOUND, FILE_NOT_FOUND } from './vsutil/fileinterface';
import { WorkspaceItem, Workspace } from './vsutil/ws';
import { vsutil, QuickPick } from './vsutil/vsutil';
import { Logger } from './vsutil/log';
import { Task } from './vsutil/work';

import { Config } from './config';
import { FtpManager } from './ftpmgr';

export interface BatchOptions
{
	// in
	doNotRefresh?:boolean;
	doNotMakeDirectory?:boolean;
	ignoreNotExistFile?:boolean;
	forceRefresh?:boolean;
	cancelWhenLatest?:boolean;
	whenRemoteModed?:"upload"|"diff"|"ignore";
}

function testLatest(file:VFSState|undefined, localStat:Stats):boolean
{
    if (!file) return false;
    switch(file.type)
    {
    case "-":
        if (!localStat.isFile()) return false;
		if (file instanceof VFSFileCommon)
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


class RefreshedData extends Deferred<VFSDirectory>
{
	accessTime:number = new Date().valueOf();

	constructor()
	{
		super();
	}
}

export class UploadReport
{
	directoryIgnored?:boolean;
	latestIgnored?:boolean;
	modifiedIgnore?:boolean;
	noFileIgnored?:boolean;
	file?:VFSState;
}

export interface TaskList
{
	[key:string]:string;
}

interface TaskJsonResult
{
	tasks:TaskList;
	count:number;
}

export class FtpCacher implements WorkspaceItem
{
	public readonly config:ServerConfig;
	public readonly mainConfig:Config;

	private readonly fs:FileSystem = new FileSystem;
	private readonly refreshed:Map<string, RefreshedData> = new Map;
	private readonly logger:Logger;
	private readonly ftpmgr:FtpManager;

	private readonly configLoadListener = ()=>{
		const remotePath = this.mainConfig.remotePath || '';
		this.fs.root.name = remotePath.startsWith('/') ? '' : '.';
		this.fs.uri = this.mainConfig.url || '';
	};
	
	constructor(public readonly workspace:Workspace, config?:ServerConfig)
	{
		this.mainConfig = workspace.query(Config);
		this.config = config || this.mainConfig;
		this.ftpmgr = new FtpManager(workspace, this.config);
		this.logger = workspace.query(Logger);

		this.mainConfig.onLoad(this.configLoadListener);
	}
	
	public dispose():void
	{
		this.destroy();
	}

	public destroy():void
	{
		this.mainConfig.onLoad.remove(this.configLoadListener);
		this.ftpmgr.destroy();
	}

	
	public serialize():any
	{
		return this.fs.serialize();
	}

	public deserialize(data:any):void
	{
		this.fs.deserialize(data);
	}

	public ftppath(path:File):string
	{
		return ftp_path.normalize(this.config.remotePath + this.mainConfig.workpath(path));
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

	public async ftpDelete(task:Task, path:File, options?:BatchOptions):Promise<void>
	{
		const ftppath = this.ftppath(path);

		const deleteTest = async(file:VFSState):Promise<void>=>{
			if (file instanceof VFSDirectory) await this.ftpmgr.rmdir(task, ftppath);
			else await this.ftpmgr.remove(task, ftppath);
			this._fsDelete(ftppath);
		}

		var file:VFSState|undefined = this.fs.get(ftppath);
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

	public async ftpUpload(task:Task, path:File, options?:BatchOptions):Promise<UploadReport>
	{
		const noptions = options || {};
		const ftppath = this.ftppath(path);
		const report = new UploadReport;
	
		var stats:Stats;
		var oldfile:VFSState|undefined = undefined;
		
		try
		{
			stats = await path.stat();
		}
		catch(e)
		{
			if (e.code === 'ENOENT' && noptions.ignoreNotExistFile)
			{
				report.noFileIgnored = true;
				return report;
			}
			throw e;
		}
		
		const next = async ():Promise<UploadReport>=>{
			if (stats.isDirectory())
			{
				if (noptions.doNotMakeDirectory)
				{
					report.directoryIgnored = true;
					return report;
				}

				if (oldfile)
				{
					if (oldfile instanceof VFSDirectory)
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
					if (e.code === 'ENOENT' && noptions.ignoreNotExistFile)
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

		if (!noptions.cancelWhenLatest && noptions.whenRemoteModed === 'ignore')
		{
			return await next();
		}

		const filedir = this.fs.get(this.ftppath(path.parent()));
		if (!filedir) return await next();
		const ftpfile = await this.ftpStat(task, ftppath);
		if (!ftpfile) return await next();

		const mtime = +stats.mtime;
		const isLatest = mtime === ftpfile.lmtime || mtime <= ftpfile.lmtimeWithThreshold;
		
		if (isLatest)
		{
			if (noptions.cancelWhenLatest)
			{
				report.latestIgnored = true;
				report.file = ftpfile;
				return report;
			}
		}

		if (ftpfile.modified)
		{
			switch (noptions.whenRemoteModed)
			{
			case 'upload':
				return await next();
			case 'ignore':
				report.modifiedIgnore = true;
				report.file = ftpfile;
				return report;
			case 'diff':
			default:
				var diffFile:File;
				try
				{
					diffFile = await this.ftpDiff(task, path, true);
				}
				catch (err)
				{
					if (err === 'SAME')
					{
						report.file = ftpfile;
						return report;
					}
					throw err;
				}
				const selected = await vsutil.info('Remote file modification detected', 'Upload', 'Download');
				try
				{
					await diffFile.unlink();
				}
				catch(err)
				{
				}
				switch (selected)
				{
				case 'Upload':
					return await next();
				case 'Download':
					await this.ftpDownload(task, path);
					throw 'IGNORE';
				case undefined:
					throw 'IGNORE';
				}
				break;
			}
		}

		return await next();
	}

	public async ftpDownload(task:Task, path:File, options?:BatchOptions):Promise<void>
	{
		const ftppath = this.ftppath(path);
		var file:VFSState|undefined = this.fs.get(ftppath);
		if (!file)
		{
			file = await this.ftpStat(task, ftppath, options);
			if (!file)
			{
				throw Error(`${ftppath} not found in remote`);
			}
		}

		if (file instanceof VFSDirectory) await path.mkdirp();
		else
		{
			await path.parent().mkdirp();
			await this.ftpmgr.download(task, path, ftppath);
		}
		const stats = await path.stat();
		file.lmtime = +stats.mtime;
		file.lmtimeWithThreshold = file.lmtime + (this.mainConfig.downloadTimeExtraThreshold || 1000);
		file.modified = false;
	}

	public async ftpView(task:Task, ftppath:string):Promise<string>
	{
		var file:VFSState|undefined = this.fs.get(ftppath);
		if (!file)
		{
			file = await this.ftpStat(task, ftppath);
			if (!file)
			{
				throw Error(`${ftppath} not found in remote`);
			}
		}
		if (file.size > (this.mainConfig.viewSizeLimit || 1024*1024*4)) return '< File is too large >\nYou can change file size limit with "viewSizeLimit" option in ftp-kr.json';
		return await this.ftpmgr.view(task, ftppath);
	}

	public async ftpDownloadWithCheck(task:Task, path:File):Promise<void>
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
		if (!file || (file.lmtime !== 0 && file.lmtime < +stats.mtime))
		{
			if (this.mainConfig === this.config && this.mainConfig.autoUpload)
			{
				await this.ftpUpload(task, path, {whenRemoteModed: this.mainConfig.ignoreRemoteModification?'ignore':'diff'});
			}
			else
			{
				// diff?
			}
			return;
		}

		if (file instanceof VFSFile && stats.size === file.size) return;
		if (file instanceof VFSDirectory) await path.mkdir();
		else
		{
			await path.parent().mkdirp();
			await this.ftpmgr.download(task, path, ftppath);
		}
		stats = await path.stat();
		file.lmtime = +stats.mtime;
		file.lmtimeWithThreshold = file.lmtime + (this.mainConfig.downloadTimeExtraThreshold || 1000);
		file.modified = false;
	}

	public async ftpStat(task:Task, ftppath:string, options?:BatchOptions):Promise<VFSState|undefined>
	{
		const parent = ftp_path.dirname(ftppath);
		const dir = await this.ftpList(task, parent, options);
		return dir.files[ftp_path.basename(ftppath)];
	}

	public async ftpTargetStat(task:Task, linkfile:VFSState):Promise<VFSState|undefined>
	{
		for (;;)
		{
			const target = await this.ftpmgr.readlink(task, linkfile, linkfile.getPath());
			const stats = await this.ftpStat(task, target);
			if (!stats) return undefined;
			linkfile = stats;
			if (linkfile.type !== 'l') return linkfile;
		}
	}

	public async ftpDiff(task:Task, file:File, sameCheck?:boolean):Promise<File>
	{
		const basename = file.basename();
		const diffFile:File = await this.workspace.child('.vscode/ftp-kr.diff.'+basename).findEmptyIndex();
		var title:string = basename + ' Diff';
		try
		{
			await this.ftpmgr.download(task, diffFile, this.ftppath(file));
		}
		catch (err)
		{
			if (err.ftpCode !== FILE_NOT_FOUND) throw err;
			await diffFile.create("");
			title += ' (NOT FOUND)';
		}
		if (sameCheck)
		{
			const remoteContent = await diffFile.open();
			const localContent = await file.open();
			if (remoteContent === localContent)
			{
				await diffFile.quietUnlink();
				throw 'SAME';
			}
		}
		vsutil.diff(diffFile, file, title).then(()=>diffFile.quietUnlink());
		return diffFile;
	}

	public ftpList(task:Task, ftppath:string, options?:BatchOptions):Promise<VFSDirectory>
	{
		const latest = this.refreshed.get(ftppath);
		if (latest)
		{
			if (options && options.doNotRefresh) return latest;
			if (!options || !options.forceRefresh)
			{
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

	public ftpRefreshForce(task:Task):Promise<void>
	{
		this.refreshed.clear();
		return this._refeshForce(task, ftp_path.normalize(this.mainConfig.remotePath + '.'));
	}

	public async runTaskJson(task:Task, parentDirectory:File, tasklist:TaskList):Promise<TaskJsonResult|null>
	{
		const options:BatchOptions = {doNotRefresh:true, whenRemoteModed:'upload'};

		var errorCount = 0;
		const failedTasks:TaskList = {};

		for (const workpath in tasklist)
		{
			const exec = tasklist[workpath];
			const path = this.mainConfig.fromWorkpath(workpath, parentDirectory);
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
				failedTasks[workpath] = exec;
				if (err.code === 'ENOENT')
				{
					this.logger.message("Error: file not found: '"+workpath+"'");
				}
				else
				{
					console.error(err);
					this.logger.message(err);
				}
				errorCount ++;
			}
		}
		if (errorCount)
			return {tasks:failedTasks, count:errorCount};
		else return null;
	}

	public async runTaskJsonWithConfirm(task:Task, tasks: TaskList, taskname: string, parentDirectory:File, confirmFirst:boolean): Promise<void>
	{
		var confirmer:(()=>Thenable<string|undefined>)|null = null;
		
		if (confirmFirst)
		{
			confirmer = ()=>vsutil.info("Review Operations to perform.", "OK");
		}

		for (;;)
		{
			if (isEmptyObject(tasks)) 
			{
				vsutil.info("Nothing to DO");
				return;
			}
			if (confirmer)
			{
				const taskFile = this.workspace.child(".vscode/ftp-kr.task.json");
				try
				{
					await taskFile.create(JSON.stringify(tasks, null, 1));
					await vsutil.open(taskFile);
					const res = await confirmer();
					if (res === undefined) return;
					const editor = await vsutil.open(taskFile);
					if (editor) await editor.document.save();
					const data = await taskFile.json();
				}
				finally
				{
					await taskFile.quietUnlink();
				}
			}

			this.logger.show();
			this.logger.message(taskname + ' started');
			const startTime = Date.now();
			const failed = await this.runTaskJson(task, parentDirectory, tasks);
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
			confirmer = () => this.logger.errorConfirm("ftp-kr Task failed, more information in the output", "Retry");
		}
	}

	public async uploadAll(task:Task, path: File): Promise<void>
	{
		const tasks = await this._syncTestUpload(task, path);
		await this.runTaskJsonWithConfirm(task, tasks, 'Upload All', this.mainConfig.basePath, true);
	}

	public async downloadAll(task:Task, path: File): Promise<void>
	{
		const tasks = await this._syncTestDownload(task, path)
		await this.runTaskJsonWithConfirm(task, tasks, 'Download All', this.mainConfig.basePath, true);
	}

	public async cleanAll(task:Task):Promise<void>
	{
		const tasks = await this._syncTestClean(task);
		return this.runTaskJsonWithConfirm(task, tasks, 'ftpkr.Clean All', this.mainConfig.basePath, true);
	}
	
	public async list(task:Task, path:File):Promise<void>
	{
		const openFile = (file:VFSState)=>{
			const npath = path.child(file.name);
			pick.clear();
			pick.item('Download '+file.name, ()=>this.ftpDownload(task, npath));
			pick.item('Upload '+file.name, ()=>this.ftpUpload(task, npath, {whenRemoteModed: this.mainConfig.ignoreRemoteModification?'upload':'diff'}));
			pick.item('Delete '+file.name, ()=>this.ftpDelete(task, npath));
			pick.item('Diff '+file.name, ()=>this.ftpDiff(task, npath));
			pick.oncancel = ()=>this.list(task, path);
			return pick.open();
		};
		const openDirectory = (dir:VFSState)=>this.list(task, path.child(dir.name));

		const ftppath = this.ftppath(path);
		const dir = await this.ftpList(task, ftppath);
		const pick = new QuickPick;
		if (path.fsPath !== this.mainConfig.basePath.fsPath)
		{
			pick.item('Current VFSDirectory Action', ()=>{
				const pick = new QuickPick;
				pick.item('Download Current VFSDirectory', ()=>this.downloadAll(task, path));
				pick.item('Upload Current VFSDirectory', ()=>this.uploadAll(task, path));
				pick.item('Delete Current VFSDirectory', ()=>this.ftpDelete(task, path));
				pick.oncancel = ()=>this.list(task, path);
				return pick.open();
			});
		}
		
		var files:VFSState[] = [];
		var dirs:VFSState[] = [];
		var links:VFSState[] = [];

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
			pick.item('[DIR]\t' + dir.name, ()=>openDirectory(dir));
		}

		for (const link of links)
		{
			pick.item('[LINK]\t' + link.name, async()=>{
				const stats = await this.ftpTargetStat(task, link);
				if (!stats) return await this.list(task, path);
				switch (stats.type)
				{
				case 'd':
					return await openDirectory(link);
				case '-':
					return await openFile(stats);
				}
			});
		}

		for (const file of files)
		{
			pick.item('[FILE]\t' + file.name, ()=>openFile(file));
		}
		
		await pick.open();
	}
	
	private async _syncTestUpload(task:Task, path:File):Promise<TaskList>
	{
		const list = {};
		await this._getUpdatedFile(this.fs.root, path, list)
		
		const output = {};
		for(const workpath in list)
		{
			const path = this.mainConfig.fromWorkpath(workpath, this.mainConfig.basePath);
			const ftppath = this.ftppath(path);
			const st = list[workpath];
			
			const file = await this.ftpStat(task, ftppath);
			if (!await testLatest(file, st))
			{
				output[workpath] = "upload";
			}
		}
		return output;
	}

	private _syncTestDownload(task:Task, path:File):Promise<TaskList>
	{
		const list:TaskList = {};
		return this._listNotExists(task, path, list, true)
		.then(() => list);
	}

	private _syncTestClean(task:Task):Promise<TaskList>
	{
		const list:TaskList = {};
		return this._listNotExists(task, this.mainConfig.basePath, list, false)
		.then(() => list);
	}

	private async _listNotExists(task:Task, path:File, list:TaskList, download:boolean):Promise<void>
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
					list[this.mainConfig.workpath(path.child(p))] = command;
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

	private async _getUpdatedFileInDir(cmp:VFSDirectory|undefined, path:File, list:{[key:string]:Stats}):Promise<void>
	{
		const files = await path.children();
		for (const child of files)
		{
			var childfile:VFSState|undefined;
			if (cmp)
			{
				const file = cmp.files[child.basename()];
				if (file) childfile = file;
			}
			await this._getUpdatedFile(childfile, child, list);
		}
	}
	
	private async _getUpdatedFile(cmp:VFSState|undefined, path:File, list:{[key:string]:Stats}):Promise<void>
	{
		if (this.mainConfig.checkIgnorePath(path)) return;
		try
		{
			const st = await path.lstat();
			if (st.isDirectory()) await this._getUpdatedFileInDir(cmp instanceof VFSDirectory ? cmp : undefined, path, list);
			if (testLatest(cmp, st)) return;
			list[this.mainConfig.workpath(path)] = st;
		}
		catch(err)
		{
		}
	}

	private _deletedir(dir:VFSDirectory, path:string):void
	{
		if (!this.refreshed.delete(path)) return;
		for(const filename in dir.files)
		{
			const childdir = dir.files[filename];
			if (!(childdir instanceof VFSDirectory)) continue;
			this._deletedir(childdir, path+'/'+filename);
		}
	}

	private _fsDelete(path:string):void
	{
		const dir = this.fs.get(path);
		if (dir) this._deletedir(dir, path);
		this.fs.delete(path);
	}
	
	private async _refeshForce(task:Task, ftppath:string):Promise<void>
	{
		const dir = await this.ftpList(task, ftppath);
		for(const p in dir.files)
		{
			switch(p)
			{
			case '': case '.': case '..': break;
			default:
				if (dir.files[p] instanceof VFSDirectory)
				{
					await this._refeshForce(task, ftp_path.normalize(ftppath + '/' + p));
				}
				break;
			}
		}
	}
}

export class AltFtpCacher extends FtpCacher
{
	public reference:number = 1;
}

export class FtpSyncManager implements WorkspaceItem
{
	private readonly logger:Logger;
	private readonly config:Config;
	private readonly ftpcacher:FtpCacher;
	private readonly cacheFile:File;
	private readonly altServers:Map<ServerConfig, AltFtpCacher>;
	
	constructor(public readonly workspace:Workspace)
	{
		this.logger = workspace.query(Logger);
		this.config = workspace.query(Config);
		this.ftpcacher = workspace.query(FtpCacher);
		this.cacheFile = this.workspace.child('.vscode/ftp-kr.sync.cache.json');
	}

	public async init(task:Task):Promise<void>
	{
		try
		{
			if (this.config.createSyncCache)
			{
				const data = await this.cacheFile.open();
				this.ftpcacher.deserialize(JSON.parse(data));
			}
		}
		catch (err)
		{
		}
		await this.ftpcacher.ftpList(task, this.config.remotePath || '.').then(()=>{});
	}

	dispose():void
	{
		try
		{
			if (this.config.createSyncCache)
			{
				this.cacheFile.createSync(JSON.stringify(this.ftpcacher.serialize(), null, 2));
			}
		}
		catch(err)
		{
			console.error(err);
		}
	}

	getServer(config:ServerConfig):FtpCacher
	{
		if (config === this.config) return this.ftpcacher;
		var cacher = this.altServers.get(config);
		if (cacher)
		{
			cacher.reference ++;
			return cacher;
		}
		
		cacher = new AltFtpCacher(this.workspace, config);
		this.altServers.set(config, cacher);
		return cacher;
	}

	releaseServer(cacher:FtpCacher):void
	{
		if (!(cacher instanceof AltFtpCacher)) return;
		cacher.reference --;
		if (cacher.reference === 0)
		{
			this.altServers.delete(cacher.config);
			cacher.destroy();
		}
	}

	async selectServer():Promise<FtpCacher|undefined>
	{
		var selected:FtpCacher|undefined = undefined;
		const pick = new QuickPick;
		pick.item(this.config.name || 'Main Server', ()=>{ selected = this.ftpcacher;});
		for (const server of this.config.getAltServers())
		{
			const name = server.name || server.host;
			if (!name) continue;
			pick.item(name, ()=>{ selected = this.getServer(server); });
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

	public reconnect(task:Task):Promise<void>
	{
		this.ftpcacher.destroy();
		return this.init(task);
	}

	public upload(task:Task, path:File, options?:BatchOptions):Promise<UploadReport>
	{
		return this.ftpcacher.ftpUpload(task, path, options);
	}

	public download(task:Task, path:File, doNotRefresh?:boolean):Promise<void>
	{
		return this.ftpcacher.ftpDownload(task, path, {doNotRefresh});
	}

	public diff(task:Task, path:File):Promise<void>
	{
		return this.ftpcacher.ftpDiff(task, path).then(()=>{});
	}

	public downloadWithCheck(task:Task, path:File):Promise<void>
	{
		return this.ftpcacher.ftpDownloadWithCheck(task, path);
	}

	public refreshForce(task:Task):Promise<void>
	{
		return this.ftpcacher.ftpRefreshForce(task);
	}

	public remove(task:Task, path:File):Promise<void>
	{
		return this.ftpcacher.ftpDelete(task, path);
	}

	public async uploadAll(task:Task, path:File): Promise<void>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return;
		await selected.uploadAll(task, path);
		this.releaseServer(selected);
	}

	public async downloadAll(task:Task, path:File): Promise<void>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return;
		await selected.downloadAll(task, path);
		this.releaseServer(selected);
	}

	public async cleanAll(task:Task)
	{
		const selected = await this.selectServer();
		if (selected === undefined) return;
		await selected.cleanAll(task);
		this.releaseServer(selected);
	}
	
	public async list(task:Task, path:File):Promise<void>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return;
		await selected.list(task, path);
		this.releaseServer(selected);
	}

	public async runTaskJson(task:Task, taskjson:File):Promise<void>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return;
		const tasks = await taskjson.json();
		await selected.runTaskJsonWithConfirm(task, tasks, taskjson.basename(), taskjson.parent(), false);
		this.releaseServer(selected);
	}
}
