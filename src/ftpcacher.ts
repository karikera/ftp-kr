import { File, Stats } from 'krfile';

import {
	VFSDirectory,
	VFSFile,
	VFSServer,
	VFSServerList,
	VFSState,
} from './util/filesystem';
import { ftp_path } from './util/ftp_path';
import { ServerConfig } from './util/serverinfo';
import { Deferred, isEmptyObject } from './util/util';

import { FtpErrorCode } from './vsutil/fileinterface';
import { Logger } from './vsutil/log';
import { QuickPick, vsutil } from './vsutil/vsutil';
import { Scheduler, Task } from './vsutil/work';
import { Workspace } from './vsutil/ws';

import { Config } from './config';
import { FtpManager } from './ftpmgr';
import { printMappedError } from './util/sm';
import { TemporalDocument } from './vsutil/tmpfile';

export interface BatchOptions {
	// in
	confirmFirst?: boolean; // upload/download All
	doNotRefresh?: boolean;
	doNotMakeDirectory?: boolean; // upload
	ignoreNotExistFile?: boolean; // upload
	forceRefresh?: boolean;
	cancelWhenLatest?: boolean; // upload
	whenRemoteModed?: 'upload' | 'diff' | 'ignore' | 'error'; // upload/upload all
	skipModCheck?: boolean; // upload/download All
	parentDirectory?: File;
	skipIgnoreChecking?: boolean; // upload/download/delete All

	// out
	refreshed?: boolean;
}

async function isSameFile(
	file: VFSState | undefined,
	local: Stats | File
): Promise<boolean> {
	if (local instanceof File) {
		try {
			local = await local.stat();
		} catch (err) {
			if (err.code === 'ENOENT') {
				if (!file) return true;
				return false;
			}
			throw err;
		}
	}
	if (!file) return false;
	switch (file.type) {
		case '-':
			if (!local.isFile()) return false;
			if (file instanceof VFSState) {
				if (local.size !== file.size) return false;
				if (file.lmtimeWithThreshold !== 0) {
					// it has lmtime
					if (local.mtimeMs > file.lmtimeWithThreshold) return false;
				} else {
					// it does not have lmtime. update it.
					file.lmtime = file.lmtimeWithThreshold = local.mtimeMs;
				}
			}
			break;
		case 'd':
			if (!local.isDirectory()) return false;
			break;
		case 'l':
			if (!local.isSymbolicLink()) return false;
			break;
	}
	return true;
}

class RefreshedData extends Deferred<VFSDirectory> {
	accessTime: number = new Date().valueOf();

	constructor() {
		super();
	}
}

export class UploadReport {
	directoryIgnored?: boolean;
	latestIgnored?: boolean;
	noFileIgnored?: boolean;
	modifiedIgnored?: boolean;
	quickPickRequested?: boolean;
	file?: VFSState;
}

export interface TaskList {
	[key: string]: string;
}

export interface ViewedFile {
	file?: VFSState;
	content: Buffer;
	error?: string;
}

interface TaskJsonResult {
	tasks: TaskList;
	count: number;
	modified: number;
}

class TaskFileConfirm {
	private readonly taskFile: File;
	private tmpDoc: TemporalDocument | null = null;

	constructor(public readonly workspace: Workspace) {
		this.taskFile = this.workspace.child('.vscode/ftp-kr.task.json');
	}

	async confirm(
		tasks: TaskList,
		confirmer: Thenable<string | undefined>
	): Promise<TaskList | null> {
		try {
			if (this.tmpDoc !== null) {
				this.tmpDoc.close();
				this.tmpDoc = null;
			}
			await this.taskFile.create(JSON.stringify(tasks, null, 1));
			await vsutil.open(this.taskFile);
			this.tmpDoc = new TemporalDocument(this.taskFile, this.taskFile);
			const res = await Promise.race([this.tmpDoc.onClose, confirmer]);
			if (res === undefined) return null;
			const editor = await vsutil.open(this.taskFile);
			await editor.document.save();
			tasks = await this.taskFile.json();
		} finally {
			if (this.tmpDoc !== null) {
				this.tmpDoc.close();
				this.tmpDoc = null;
			}
		}
		return tasks;
	}
}

export class FtpError extends Error {
	constructor(error: string, public description: string) {
		super(error);
	}
}

export class FtpCacher {
	public readonly mainConfig: Config;
	private readonly ftpmgr: FtpManager;

	private readonly refreshed: Map<string, RefreshedData> = new Map();

	public readonly logger: Logger;
	public readonly scheduler: Scheduler;

	public readonly fs: VFSServer;
	public home: VFSDirectory;
	public remotePath: string;

	private readonly confirm: TaskFileConfirm;

	constructor(
		public readonly workspace: Workspace,
		public readonly config: ServerConfig,
		fs: VFSServerList
	) {
		this.mainConfig = workspace.query(Config);
		this.config = config;
		this.ftpmgr = new FtpManager(workspace, this.config);
		this.scheduler = workspace.query(Scheduler);

		this.fs = fs.item(config.hostUrl || '');
		this.logger = workspace.query(Logger);

		this.home = <any>undefined;
		this.remotePath = <any>undefined;

		this.confirm = new TaskFileConfirm(workspace);
	}

	public getName(): string {
		let name = this.workspace.name;
		if (this.config.name) name += '/' + this.config.name;
		return name;
	}

	public init(task?: Task | null): Promise<void> {
		if (this.remotePath !== undefined) return Promise.resolve();
		return this.scheduler.task(
			'first connect',
			async (task) => {
				await this.ftpList(this.config.remotePath, task);
				this.remotePath = this.ftpmgr.resolvePath(this.config.remotePath);
				if (this.remotePath === '/') this.remotePath = '';
				this.home = <VFSDirectory>(
					this.fs.getDirectoryFromPath(this.remotePath, true)
				);
			},
			task
		);
	}

	public terminate(): void {
		this.ftpmgr.terminate();
	}

	private _ftpPathInRemotePath(ftppath: string): boolean {
		if (ftppath.startsWith(this.remotePath)) {
			const slashOrEmpty = ftppath.charAt(this.remotePath.length);
			if (slashOrEmpty === '/' || slashOrEmpty === '') {
				return true;
			}
		}
		return false;
	}

	public toWorkPathFromFtpPath(ftppath: string): string {
		ftppath = ftp_path.normalize(ftppath);
		if (ftppath === '/' && this.remotePath === '') return '/';
		if (ftppath === '.' && this.remotePath === '.') return '/';

		if (!this._ftpPathInRemotePath(ftppath))
			throw Error(`${ftppath} is not in remotePath`);
		return ftppath.substr(this.remotePath.length);
	}

	public toFtpFileFromFtpPath(ftppath: string): VFSState | undefined {
		if (!this._ftpPathInRemotePath(ftppath))
			throw Error(`${ftppath} is not in remotePath`);
		return this.fs.getFromPath(ftppath);
	}

	public toFtpPath(path: File): string {
		return ftp_path.normalize(this.remotePath + this.mainConfig.workpath(path));
	}

	public toFtpFile(path: File): VFSState | undefined {
		return this.toFtpFileFromFtpPath(this.toFtpPath(path));
	}

	public toFtpUrl(path: File): string {
		const ftppath = this.toFtpPath(path);
		return this.config.hostUrl + ftppath;
	}

	public fromFtpFile(ftpfile: VFSState): File {
		console.assert(ftpfile instanceof VFSState);
		const ftppath = ftpfile.getPath();
		return this.fromFtpPath(ftppath);
	}

	public fromFtpPath(ftppath: string): File {
		return this.mainConfig.fromWorkpath(this.toWorkPathFromFtpPath(ftppath));
	}

	private async _clearAndRmdir(
		task: Task,
		ftppath: string,
		opts: BatchOptions
	): Promise<void> {
		const dir = await this._list(ftppath, null, task, opts);
		if (dir.fileCount !== 0) {
			const slashPath = ftppath.endsWith('/') ? ftppath : ftppath + '/';
			for (const item of dir.children()) {
				const name = item.name;
				const subPath: string = name[0] === '/' ? name : slashPath + name;

				if (item.type === 'd') {
					if (name !== '.' && name !== '..') {
						await this._rmdir(task, subPath);
					}
				} else {
					await this.ftpmgr.remove(task, subPath);
				}
			}
		}
		await this.ftpmgr.rmdir(task, ftppath);
	}

	private async _rmdir(task: Task, ftppath: string): Promise<void> {
		try {
			await this._clearAndRmdir(task, ftppath, { doNotRefresh: true });
			return;
		} catch (err) {
			if (
				err.ftpCode !== FtpErrorCode.REQUEST_RECURSIVE &&
				err.ftpCode !== FtpErrorCode.UNKNOWN
			) {
				throw err;
			}
		}
		try {
			await this._clearAndRmdir(task, ftppath, { forceRefresh: true });
		} catch (err) {
			delete err.ftpCode;
			throw err;
		}
	}

	public ftpDelete(
		ftppathOrFile: string | File,
		task?: Task | null,
		options: BatchOptions = {}
	): Promise<void> {
		const ftppath =
			ftppathOrFile instanceof File
				? this.toFtpPath(ftppathOrFile)
				: ftppathOrFile;
		if (ftppath === '/') throw Error('Invalid task');
		return this.scheduler.task(
			'Delete',
			async (task) => {
				await this.init(task);

				const deleteTest = async (file: VFSState): Promise<void> => {
					if (file instanceof VFSDirectory) await this._rmdir(task, ftppath);
					else await this.ftpmgr.remove(task, ftppath);
					this._fsDelete(ftppath);
				};

				let file: VFSState | undefined = this.fs.getFromPath(ftppath);
				if (file) {
					try {
						return await deleteTest(file);
					} catch (err) {
						// empty
					}
				}
				file = await this.ftpStat(ftppath, task, options);
				if (!file) return;
				await deleteTest(file);
			},
			task
		);
	}

	public ftpRename(from: File, to: File, task?: Task | null): Promise<void> {
		return this.scheduler.task(
			'Rename',
			async (task) => {
				await this.init(task);
				const ftppathFrom = this.toFtpPath(from);
				const ftppathTo = this.toFtpPath(to);

				const renameTest = async (from: VFSState): Promise<void> => {
					await this.ftpmgr.rename(task, ftppathFrom, ftppathTo);
					this._fsDelete(ftppathFrom);
					this.fs.setFromItem(ftppathTo, from);
				};

				let file: VFSState | undefined = this.fs.getFromPath(ftppathFrom);
				if (file) {
					try {
						return await renameTest(file);
					} catch (err) {
						// empty
					}
				}
				file = await this.ftpStat(ftppathFrom, task);
				if (!file) return;
				await renameTest(file);
			},
			task
		);
	}

	public ftpMkdir(
		ftppathOrFile: string | File,
		task?: Task | null
	): Promise<void> {
		const ftppath =
			ftppathOrFile instanceof File
				? this.toFtpPath(ftppathOrFile)
				: ftppathOrFile;
		return this.scheduler.task(
			'Mkdir',
			async (task) => {
				await this.init(task);

				const mtime = Date.now();
				await this._mkdir(task, ftppath);

				const dir = this.fs.mkdir(ftppath);
				dir.lmtimeWithThreshold = dir.lmtime = mtime;
				dir.remoteModified = false;
				return;
			},
			task
		);
	}

	private async _mkdir(task: Task, ftppath: string): Promise<void> {
		try {
			await this.ftpmgr.mkdir(task, ftppath);
		} catch (err) {
			if (err.ftpCode !== FtpErrorCode.REQUEST_RECURSIVE) {
				if (err.ftpCode === FtpErrorCode.UNKNOWN) {
					const stat = await this.ftpStat(ftppath, task, {
						forceRefresh: true,
					});
					if (stat !== undefined) return;
				} else {
					throw err;
				}
			}
			const errorMessageOverride = err.message;
			const idx = ftppath.lastIndexOf('/');
			if (idx <= 0) throw err;
			return this._mkdir(task, ftppath.substr(0, idx)).then(
				() => this.ftpmgr.mkdir(task, ftppath),
				(err) => {
					console.error(err.message);
					err.message = errorMessageOverride;
					throw err;
				}
			);
		}
	}

	private _upload(task: Task, ftppath: string, localpath: File): Promise<void> {
		return this.ftpmgr.upload(task, ftppath, localpath).catch((err) => {
			if (err.ftpCode !== FtpErrorCode.REQUEST_RECURSIVE) throw err;
			const errorMessageOverride = err.message;
			const idx = ftppath.lastIndexOf('/');
			if (idx <= 0) throw err;
			return this._mkdir(task, ftppath.substr(0, idx)).then(
				() => this.ftpmgr.upload(task, ftppath, localpath),
				(err) => {
					console.error(err.message);
					err.message = errorMessageOverride;
					throw err;
				}
			);
		});
	}

	public ftpUpload(
		path: File,
		task?: Task | null,
		options?: BatchOptions
	): Promise<UploadReport> {
		return this.scheduler.task(
			'Upload',
			async (task) => {
				await this.init(task);

				const noptions = options || {};
				const ftppath = this.toFtpPath(path);
				const report = new UploadReport();

				let stats: Stats;
				let oldfile: VFSState | undefined = undefined;

				try {
					stats = await path.stat();
				} catch (e) {
					if (e.code === 'ENOENT' && noptions.ignoreNotExistFile) {
						report.noFileIgnored = true;
						return report;
					}
					throw e;
				}

				const next = async (): Promise<UploadReport> => {
					if (stats.isDirectory()) {
						if (noptions.doNotMakeDirectory) {
							report.directoryIgnored = true;
							return report;
						}

						if (oldfile) {
							if (oldfile instanceof VFSDirectory) {
								oldfile.lmtimeWithThreshold = oldfile.lmtime = stats.mtimeMs;
								report.file = oldfile;
								return report;
							}
							await this.ftpDelete(ftppath, task);
						}
						await this._mkdir(task, ftppath);

						const dir = this.fs.mkdir(ftppath);
						dir.lmtimeWithThreshold = dir.lmtime = stats.mtimeMs;
						dir.remoteModified = false;
						report.file = dir;
						return report;
					} else {
						try {
							await this._upload(task, ftppath, path);
						} catch (e) {
							if (e.code === 'ENOENT' && noptions.ignoreNotExistFile) {
								report.noFileIgnored = true;
								return report;
							}
							throw e;
						}

						const file = this.fs.createFromPath(ftppath);
						file.date = 0;
						file.lmtimeWithThreshold = file.lmtime = stats.mtimeMs;
						file.remoteModified = false;
						file.size = stats.size;
						report.file = file;
						return report;
					}
				};

				const parentFtpPath = this.toFtpPath(path.parent());
				const filedir = this.fs.getDirectoryFromPath(parentFtpPath);
				if (!filedir) return await next();

				oldfile = await this.ftpStat(ftppath, task);
				if (!oldfile) return await next();

				if (
					!noptions.cancelWhenLatest &&
					noptions.whenRemoteModed === 'upload'
				) {
					return await next();
				}

				const mtime = stats.mtimeMs;
				const isLatest =
					mtime === oldfile.lmtime || mtime <= oldfile.lmtimeWithThreshold;

				if (isLatest) {
					if (noptions.cancelWhenLatest) {
						report.latestIgnored = true;
						report.file = oldfile;
						return report;
					}
				}

				if (oldfile.remoteModified) {
					switch (noptions.whenRemoteModed) {
						case 'upload':
							return await next();
						case 'ignore':
							report.modifiedIgnored = true;
							report.file = oldfile;
							return report;
						case 'error':
							throw 'MODIFIED';
						case 'diff':
						default:
							let diffDoc: TemporalDocument;
							try {
								diffDoc = await this.ftpDiff(path, task, true);
							} catch (err) {
								if (err === 'SAME') {
									report.file = oldfile;
									return report;
								}
								throw err;
							}
							vsutil
								.info('Remote file modification detected', 'Upload', 'Download')
								.then(async (selected) => {
									diffDoc.close();
									switch (selected) {
										case 'Upload':
											await this.ftpUpload(path, null, {
												doNotRefresh: true,
												whenRemoteModed: 'upload',
											});
											break;
										case 'Download':
											await this.ftpDownload(path, null, {
												doNotRefresh: true,
											});
											break;
										case undefined:
											break;
									}
								});
							report.quickPickRequested = true;
							report.file = oldfile;
							return report;
					}
				}

				return await next();
			},
			task
		);
	}

	public async ftpDownload(
		path: File,
		task?: Task | null,
		options?: BatchOptions
	): Promise<void> {
		await this.scheduler.task(
			'Download',
			async (task) => {
				await this.init(task);
				const ftppath = this.toFtpPath(path);
				let file: VFSState | undefined = this.fs.getFromPath(ftppath);
				if (!file) {
					file = await this.ftpStat(ftppath, task, options);
					if (!file) {
						throw Error(`Not found in remote: ${ftppath}`);
					}
				}
				if (file.type === 'l') {
					if (!this.mainConfig.followLink) return;
					do {
						const nfile: VFSState | undefined = await this.ftpTargetStat(
							file,
							task
						);
						if (!nfile) return;
						file = nfile;
					} while (file.type === 'l');
				}

				if (file instanceof VFSDirectory) {
					await path.mkdirp();
				} else {
					await path.parent().mkdirp();
					await this.ftpmgr.download(task, path, ftppath);
				}
				const stats = await path.stat();
				file.size = stats.size;
				file.lmtime = stats.mtimeMs;
				file.lmtimeWithThreshold =
					file.lmtime + this.mainConfig.downloadTimeExtraThreshold;
				file.remoteModified = false;
			},
			task
		);
	}

	public downloadAsBuffer(
		ftppath: string,
		task?: Task | null
	): Promise<ViewedFile> {
		return this.scheduler.task<ViewedFile>(
			'View',
			async (task): Promise<ViewedFile> => {
				let file: VFSState | undefined = this.fs.getFromPath(ftppath);
				if (!file) {
					file = await this.ftpStat(ftppath, task);
					if (!file) throw new FtpError('File not found', ftppath);
				}
				if (file.size > this.mainConfig.viewSizeLimit) {
					throw new FtpError(
						'< File is too large >',
						'You can change file size limit with "viewSizeLimit" option in ftp-kr.json'
					);
				}

				const content = await this.ftpmgr.view(task, ftppath);
				return {
					file,
					content,
				};
			},
			task
		);
	}

	public uploadBuffer(
		ftppath: string,
		buffer: Buffer,
		task?: Task | null
	): Promise<void> {
		return this.scheduler.task<void>(
			'Write',
			async (task): Promise<void> => {
				const mtime = Date.now();
				await this.ftpmgr.write(task, ftppath, buffer);
				const file = this.fs.createFromPath(ftppath);
				file.lmtimeWithThreshold = file.lmtime = mtime;
				file.date = 0;
				file.remoteModified = false;
				file.size = buffer.length;
			},
			task
		);
	}

	public async ftpDownloadWithCheck(path: File, task: Task): Promise<void> {
		await this.init(task);
		const ftppath = this.toFtpPath(path);

		let stats: Stats;
		try {
			stats = await path.stat();
		} catch (e) {
			if (e.code === 'ENOENT') return; // vscode open "%s.git" file, why?
			throw e;
		}
		const file = await this.ftpStat(ftppath, task);
		if (!file || (file.lmtime !== 0 && file.lmtime < stats.mtimeMs)) {
			if (this.mainConfig === this.config && this.mainConfig.autoUpload) {
				await this.ftpUpload(path, task, {
					whenRemoteModed: this.mainConfig.ignoreRemoteModification
						? 'ignore'
						: 'diff',
				});
			} else {
				// diff?
			}
			return;
		}

		if (file instanceof VFSFile && stats.size === file.size) return;
		if (file instanceof VFSDirectory) await path.mkdir();
		else {
			await path.parent().mkdirp();
			await this.ftpmgr.download(task, path, ftppath);
		}
		stats = await path.stat();
		file.lmtime = stats.mtimeMs;
		file.lmtimeWithThreshold =
			file.lmtime + this.mainConfig.downloadTimeExtraThreshold;
		file.remoteModified = false;
	}

	public async ftpStat(
		ftppathOrFile: string | File,
		task?: Task,
		options: BatchOptions = {}
	): Promise<VFSState | undefined> {
		const ftppath =
			ftppathOrFile instanceof File
				? this.toFtpPath(ftppathOrFile)
				: ftppathOrFile;
		return this.scheduler.task(
			'Stat',
			async (task) => {
				if (ftppath === '/') {
					return await this._list(ftppath, null, task, options);
				}
				const parent = ftp_path.dirname(ftppath);
				const target = ftp_path.basename(ftppath);
				const dir = await this._list(parent, target, task, options);
				return dir.item(target);
			},
			task
		);
	}

	public ftpTargetStat(
		linkfile: VFSState,
		task?: Task | null
	): Promise<VFSState | undefined> {
		return this.scheduler.task(
			'Read Link',
			async (task) => {
				for (;;) {
					console.assert(linkfile instanceof VFSState);
					const target = await this.ftpmgr.readlink(
						task,
						linkfile,
						linkfile.getPath()
					);
					const stats = await this.ftpStat(target, task);
					if (!stats) return undefined;
					linkfile = stats;
					if (linkfile.type !== 'l') return linkfile;
				}
			},
			task
		);
	}

	public ftpDiff(
		file: File,
		task?: Task | null,
		sameCheck?: boolean
	): Promise<TemporalDocument> {
		return this.scheduler.task<TemporalDocument>(
			'Diff',
			async (task) => {
				await this.init(task);
				const basename = file.basename();
				const diffFile: File = await this.workspace
					.child('.vscode/ftp-kr.diff.' + basename)
					.findEmptyIndex();
				let title: string = basename + ' Diff';
				try {
					const ftppath = this.toFtpPath(file);
					await this.ftpmgr.download(task, diffFile, ftppath);
				} catch (err) {
					if (err.ftpCode !== FtpErrorCode.FILE_NOT_FOUND) throw err;
					await diffFile.create('');
					title += ' (NOT FOUND)';
				}
				if (sameCheck) {
					const remoteContent = await diffFile.open();
					const localContent = await file.open();
					if (remoteContent === localContent) {
						await diffFile.quietUnlink();
						throw 'SAME';
					}
				}
				const doc = await vsutil.diff(diffFile, file, title);
				return doc;
			},
			task
		);
	}

	private async _list(
		ftppath: string,
		targetFile: string | null,
		task: Task,
		options: BatchOptions
	): Promise<VFSDirectory> {
		const latest = this.refreshed.get(ftppath);
		if (latest) {
			let useLatest: boolean | null = null;
			if (options.forceRefresh) {
				useLatest = false;
			} else if (options.doNotRefresh) {
				useLatest = true;
			}
			if (useLatest === null) {
				if (latest.accessTime + this.mainConfig.refreshTime > Date.now())
					useLatest = true;
				else useLatest = false;
			}

			_needToRefresh: if (useLatest) {
				const dir = await latest;
				if (targetFile === null) {
					for (const file of dir.children()) {
						if (file.date === 0) break _needToRefresh;
					}
				} else {
					const item = dir.item(targetFile);
					if (item !== undefined && item.date === 0) break _needToRefresh;
				}
				return latest;
			}
		}
		options.refreshed = true;
		const deferred = new RefreshedData();
		this.refreshed.set(ftppath, deferred);

		await this.ftpmgr.connect(task);

		try {
			const ftpfiles = await this.ftpmgr.list(task, ftppath);
			const dir = this.fs.refresh(ftppath, ftpfiles);
			deferred.resolve(dir);
			return dir;
		} catch (err) {
			deferred.catch(() => {});
			deferred.reject(err);
			if (this.refreshed.get(ftppath) === deferred) {
				this.refreshed.delete(ftppath);
			}
			throw err;
		}
	}

	public ftpList(
		ftppath: string,
		task?: Task | null,
		options: BatchOptions = {}
	): Promise<VFSDirectory> {
		return this.scheduler.task(
			'List',
			(task) => this._list(ftppath, null, task, options),
			task
		);
	}

	public refresh(ftpFile?: VFSState): void {
		if (ftpFile) {
			const ftppath = ftpFile.getPath();
			for (const path of this.refreshed.keys()) {
				if (ftppath === path || ftppath.startsWith(path + '/')) {
					this.refreshed.delete(path);
				}
			}
		} else {
			this.refreshed.clear();
		}
	}

	public async runTaskJson(
		tasklist: TaskList,
		task: Task,
		options: BatchOptions
	): Promise<TaskJsonResult | null> {
		await this.init(task);

		let errorCount = 0;
		let modifiedCount = 0;
		const failedTasks: TaskList = {};

		for (const workpath in tasklist) {
			const exec = tasklist[workpath];
			const path = this.mainConfig.fromWorkpath(
				workpath,
				options.parentDirectory
			);
			try {
				switch (exec) {
					case 'mkdir':
						await this.ftpMkdir(path, task);
						break;
					case 'upload':
						await this.ftpUpload(path, task, options);
						break;
					case 'download':
						await this.ftpDownload(path, task, options);
						break;
					case 'delete':
						await this.ftpDelete(path, task, options);
						break;
					default:
						const [cmd, preposition, relpath] = exec.split(/[ \t]+/g, 3);
						switch (cmd) {
							case 'upload':
								switch (preposition) {
									case 'from': {
										const ftppath = this.toFtpPath(path);
										const localpath = path.parent().child(relpath);
										await this._upload(task, ftppath, localpath);
										break;
									}
									case 'to': {
										const ftppath = ftp_path.normalize(
											this.toFtpPath(path.parent()) + '/' + relpath
										);
										await this._upload(task, ftppath, path);
										break;
									}
									default:
										throw Error(
											`Invalid command: ${exec}\n'upload from/to path'`
										);
								}
								break;
							case 'download':
								switch (preposition) {
									case 'from': {
										const ftppath = ftp_path.normalize(
											this.toFtpPath(path.parent()) + '/' + relpath
										);
										await this.ftpmgr.download(task, path, ftppath);
										break;
									}
									case 'to': {
										const ftppath = this.toFtpPath(path);
										const localpath = path.parent().child(relpath);
										await this.ftpmgr.download(task, localpath, ftppath);
										break;
									}
									default:
										throw Error(
											`Invalid command: ${exec}\n'download from/to path'`
										);
								}
								break;
							default:
								throw Error(
									`Invalid command: ${exec}\n'upload' or 'download' or 'upload to path' or 'download from path'`
								);
						}
						break;
				}
			} catch (err) {
				failedTasks[workpath] = exec;
				if (err === 'MODIFIED') {
					this.logger.message(workpath + ': Remote modification detected');
					modifiedCount++;
				} else if (err.code === 'ENOENT') {
					this.logger.message(workpath + ': File not found');
				} else {
					printMappedError(err);
					this.logger.message(
						workpath + ': ' + (err.message ? err.message : err)
					);
				}
				errorCount++;
			}
		}
		if (errorCount)
			return {
				tasks: failedTasks,
				count: errorCount,
				modified: modifiedCount,
			};
		else return null;
	}

	public async runTaskJsonWithConfirm(
		taskName: string,
		tasks: TaskList,
		taskname: string,
		options: BatchOptions
	): Promise<void> {
		let confirmer: (() => Thenable<string | undefined>) | null = null;

		if (options.confirmFirst) {
			confirmer = () => vsutil.info('Review Operations to perform.', 'OK');
		}

		for (;;) {
			if (isEmptyObject(tasks)) {
				vsutil.info('Nothing to DO');
				return;
			}
			if (confirmer) {
				const newtasks = await this.confirm.confirm(tasks, confirmer());
				if (newtasks === null) break;
				tasks = newtasks;
			}

			this.logger.show();
			this.logger.message(taskname + ' started');
			const startTime = Date.now();

			const options: BatchOptions = {
				doNotRefresh: true,
				whenRemoteModed: 'upload',
			};
			const failed = await this.scheduler.task(taskName, (task) =>
				this.runTaskJson(tasks, task, options)
			);
			if (failed) {
				tasks = failed.tasks;
				confirmer = () =>
					this.logger.errorConfirm(
						'ftp-kr Task failed, more information in the output',
						'Retry'
					);
				continue;
			}
			this.mainConfig.reportTaskCompletion(taskname, startTime);
			break;
		}
	}

	public uploadAll(
		path: File | File[],
		task?: Task | null,
		options: BatchOptions = {}
	): Promise<void> {
		return this.scheduler.task(
			'Upload All',
			async (task) => {
				const tasks = await this._makeUploadTask(path, task, options);
				await Promise.resolve();
				this.runTaskJsonWithConfirm(task.name, tasks, task.name, options); // seperated task
			},
			task
		);
	}

	public downloadAll(
		path: File | File[],
		task?: Task | null,
		options: BatchOptions = {}
	): Promise<void> {
		return this.scheduler.task(
			'Download All',
			async (task) => {
				const tasks = await this._makeDownloadTask(path, task, options);
				await Promise.resolve();
				this.runTaskJsonWithConfirm(task.name, tasks, task.name, options); // seperated task
			},
			task
		);
	}

	public deleteAll(
		path: File | File[],
		task?: Task | null,
		options: BatchOptions = {}
	): Promise<void> {
		return this.scheduler.task(
			'Delete All',
			async (task) => {
				const tasks = await this._makeDeleteTask(path, task, options);
				await Promise.resolve();
				this.runTaskJsonWithConfirm(task.name, tasks, task.name, options); // seperated task
			},
			task
		);
	}

	public cleanAll(
		path: File | File[],
		task?: Task | null,
		options?: BatchOptions
	): Promise<void> {
		return this.scheduler.task(
			'Clean All',
			async (task) => {
				const tasks = await this._makeCleanTask(path, task);
				await Promise.resolve();
				this.runTaskJsonWithConfirm(task.name, tasks, task.name, options || {}); // seperated task
			},
			task
		);
	}

	public async list(path: File): Promise<void> {
		await this.init();
		const openFile = (file: VFSState) => {
			const npath = path.child(file.name);
			pick.clear();
			pick.item('Download ' + file.name, () => this.ftpDownload(npath));
			pick.item('Upload ' + file.name, () =>
				this.ftpUpload(npath, null, {
					whenRemoteModed: this.mainConfig.ignoreRemoteModification
						? 'upload'
						: 'diff',
				})
			);
			pick.item('Delete ' + file.name, () => this.ftpDelete(npath));
			pick.item('View ' + file.name, () => vsutil.openUri(file.getUri()));
			pick.item('Diff ' + file.name, () => this.ftpDiff(npath));
			pick.oncancel = () => this.list(path);
			return pick.open();
		};
		const openDirectory = (dir: VFSState) => this.list(path.child(dir.name));
		const ftppath = this.toFtpPath(path);
		const dir = await this.ftpList(ftppath);

		const pick = new QuickPick();
		pick.item(`Action for ${ftppath}`, () => {
			const pick = new QuickPick();
			pick.item(`Download ${ftppath}`, () => this.downloadAll(path));
			pick.item(`Upload ${ftppath}`, () => this.uploadAll(path));
			if (ftppath !== '/')
				pick.item(`Delete ${ftppath}`, () => this.ftpDelete(ftppath));
			pick.oncancel = () => this.list(path);
			return pick.open();
		});

		let files: VFSState[] = [];
		let dirs: VFSState[] = [];
		let links: VFSState[] = [];

		if (this.mainConfig.getBasePath().fsPath !== path.fsPath) {
			pick.item('[DIR]\t..', () => this.list(path.parent()));
		}

		for (const file of dir.children()) {
			switch (file.type) {
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
		files = files.sort((a, b) => a.name.localeCompare(b.name));
		links = links.sort((a, b) => a.name.localeCompare(b.name));
		dirs = dirs.sort((a, b) => a.name.localeCompare(b.name));

		for (const dir of dirs) {
			pick.item('[DIR]\t' + dir.name, () => openDirectory(dir));
		}

		for (const link of links) {
			pick.item('[LINK]\t' + link.name, async () => {
				const stats = await this.ftpTargetStat(link);
				if (!stats) return await this.list(path);
				switch (stats.type) {
					case 'd':
						return await openDirectory(link);
					case '-':
						return await openFile(stats);
				}
			});
		}

		for (const file of files) {
			pick.item('[FILE]\t' + file.name, () => openFile(file));
		}

		await pick.open();
	}

	private async _makeUploadTask(
		path: File | File[],
		task: Task,
		options: BatchOptions
	): Promise<TaskList> {
		await this.init(task);

		const output: TaskList = {};

		if (!(path instanceof Array)) path = [path];
		for (const p of path) {
			const stat = await this.ftpStat(p, task);
			if (await p.isDirectory()) {
				const list: { [key: string]: Stats } = {};
				try {
					await this._getUpdatedFile(stat, p, list, options);
				} catch (err) {
					// empty
				}
				for (const workpath in list) {
					const path = this.mainConfig.fromWorkpath(
						workpath,
						this.mainConfig.getBasePath()
					);
					const ftppath = this.toFtpPath(path);
					const st = list[workpath];

					const file = await this.ftpStat(ftppath, task, {
						doNotRefresh: true,
					});
					if (options.skipModCheck || !(await isSameFile(file, st))) {
						if (st.isDirectory()) {
							output[workpath] = 'mkdir';
						} else {
							output[workpath] = 'upload';
						}
					}
				}
			} else {
				if (stat !== undefined && stat.type !== '-') continue;
				const workpath = this.mainConfig.workpath(p);
				output[workpath] = 'upload';
			}
		}

		return output;
	}

	private async _makeDownloadTask(
		path: File | File[],
		task: Task,
		options: BatchOptions
	): Promise<TaskList> {
		await this.init(task);

		const list: TaskList = {};

		const _make = async (
			ftpfile: VFSState,
			file: File,
			dirlist: File[]
		): Promise<void> => {
			if (!options.skipIgnoreChecking && this.mainConfig.checkIgnorePath(file))
				return;
			if (ftpfile.type === 'l') {
				if (!this.mainConfig.followLink) return;
				const nfile = await this.ftpTargetStat(ftpfile, task);
				if (!nfile) return;
				ftpfile = nfile;
			}
			if (options.skipModCheck || !(await isSameFile(ftpfile, file))) {
				list[this.mainConfig.workpath(file)] = 'download';
			}
			if (ftpfile.type === 'd') {
				dirlist.push(file);
			}
		};
		const _makeDir = async (dir: File): Promise<void> => {
			const ftppath = this.toFtpPath(dir);
			const ftpdir = await this.ftpList(ftppath, task);

			const dirlist: File[] = [];
			for (const ftpfile of ftpdir.children()) {
				const file = dir.child(ftpfile.name);
				await _make(ftpfile, file, dirlist);
			}
			for (const dir of dirlist) {
				await _makeDir(dir);
			}
		};

		if (!(path instanceof Array)) path = [path];

		const dirlist: File[] = [];
		for (const file of path) {
			if (!options.skipIgnoreChecking && this.mainConfig.checkIgnorePath(file))
				continue;
			const ftppath = this.toFtpPath(file);
			let ftpfile = await this.ftpStat(ftppath, task);
			if (!ftpfile) continue;

			if (ftpfile.type === 'l') {
				if (!this.mainConfig.followLink) continue;
				const nfile = await this.ftpTargetStat(ftpfile, task);
				if (!nfile) continue;
				ftpfile = nfile;
			}
			list[this.mainConfig.workpath(file)] = 'download';
			if (ftpfile.type === 'd') {
				dirlist.push(file);
			}
		}
		for (const dir of dirlist) {
			await _makeDir(dir);
		}
		return list;
	}

	private async _makeDeleteTask(
		path: File | File[],
		task: Task,
		options: BatchOptions
	): Promise<TaskList> {
		await this.init(task);
		const list: TaskList = {};

		const _make = async (file: File): Promise<void> => {
			if (!options.skipIgnoreChecking && this.mainConfig.checkIgnorePath(file))
				return;
			if (file.fsPath === this.workspace.fsPath) {
				const ftppath = this.toFtpPath(file);
				const ftpdir = await this.ftpList(ftppath, task);

				for (const ftpfile_child of ftpdir.children()) {
					await _make(file.child(ftpfile_child.name));
				}
			} else {
				list[this.mainConfig.workpath(file)] = 'delete';
			}
		};

		if (!(path instanceof Array)) {
			path = [path];
		}

		if (path.length === 1) {
			const ftppath = this.toFtpPath(path[0]);
			const ftpfile = await this.ftpStat(ftppath, task);
			if (!ftpfile) return list;
			if (ftpfile.type === 'd') {
				const ftpdir = await this.ftpList(ftppath, task);
				if (ftpdir.fileCount === 0) {
					if (path[0].fsPath === this.workspace.fsPath) return list;
					list[this.mainConfig.workpath(path[0])] = 'delete';
					return list;
				}
			}
		}

		for (const p of path) {
			await _make(p);
		}
		return list;
	}

	private async _makeCleanTask(
		path: File | File[],
		task: Task
	): Promise<TaskList> {
		await this.init(task);
		const list: TaskList = {};

		const _listNotExists = async (path: File): Promise<void> => {
			let fslist: File[];
			try {
				fslist = await path.children();
			} catch (err) {
				return;
			}

			const ftppath = this.toFtpPath(path);
			const dir = await this.ftpList(ftppath, task);
			const targets = new Set<string>();

			for (let file of dir.children()) {
				const fullPath = path.child(file.name);
				if (this.mainConfig.checkIgnorePath(fullPath)) continue;
				if (file.type === 'l') {
					if (!this.mainConfig.followLink) continue;
					const nfile = await this.ftpTargetStat(file, task);
					if (!nfile) continue;
					file = nfile;
				}
				targets.add(file.name);
				if (file.type === 'd') {
					await _listNotExists(fullPath);
				}
			}
			for (const file of fslist) {
				targets.delete(file.basename());
			}
			for (const p of targets) {
				list[this.mainConfig.workpath(path.child(p))] = 'delete';
			}
		};

		if (!(path instanceof Array)) path = [path];

		for (const fullPath of path) {
			if (!(await fullPath.isDirectory())) continue;
			if (this.mainConfig.checkIgnorePath(fullPath)) continue;

			const ftppath = this.toFtpPath(fullPath);
			let file = await this.ftpStat(ftppath, task);
			if (!file) continue;
			if (file.type === 'l') {
				if (!this.mainConfig.followLink) continue;
				const nfile = await this.ftpTargetStat(file, task);
				if (!nfile) continue;
				file = nfile;
			}
			if (file.type === 'd') {
				await _listNotExists(fullPath);
			}
		}
		return list;
	}

	private async _getUpdatedFileInDir(
		cmp: VFSDirectory | undefined,
		path: File,
		list: { [key: string]: Stats },
		options: BatchOptions
	): Promise<void> {
		const files = await path.children();
		for (const child of files) {
			let childfile: VFSState | undefined;
			if (cmp) {
				const file = cmp.item(child.basename());
				if (file) childfile = file;
			}
			await this._getUpdatedFile(childfile, child, list, options);
		}
	}

	private async _getUpdatedFile(
		cmp: VFSState | undefined,
		path: File,
		list: { [key: string]: Stats },
		options: BatchOptions
	): Promise<void> {
		if (!options.skipIgnoreChecking && this.mainConfig.checkIgnorePath(path))
			return;
		try {
			const st = await path.lstat();
			if (options.skipModCheck || !(await isSameFile(cmp, st))) {
				list[this.mainConfig.workpath(path)] = st;
			}
			if (st.isDirectory()) {
				await this._getUpdatedFileInDir(
					cmp instanceof VFSDirectory ? cmp : undefined,
					path,
					list,
					options
				);
			}
		} catch (err) {
			// empty
		}
	}

	private _deletedir(dir: VFSDirectory, ftppath: string): void {
		if (!this.refreshed.delete(ftppath)) return;
		for (const child of dir.children()) {
			if (!(child instanceof VFSDirectory)) continue;
			this._deletedir(child, ftppath + '/' + child.name);
		}
	}

	private _fsDelete(ftppath: string): void {
		const dir = this.fs.getDirectoryFromPath(ftppath);
		if (dir) this._deletedir(dir, ftppath);
		this.fs.deleteFromPath(ftppath);
	}

	/**
	 * return false if files not contains directory
	 */
	async isFileCountOver(files: File[] | File, count: number): Promise<boolean> {
		const checkFiles = async (files: File[]): Promise<void> => {
			for (const file of files) {
				const ftppath = this.toFtpPath(file);
				const ftpfile = await this.ftpStat(ftppath);
				if (ftpfile !== undefined && ftpfile.type === 'd') {
					const dir = await this.ftpList(ftppath);
					count -= dir.fileCount;
				}
				count--;
				if (count <= 0) throw 'OVER';
				await checkFiles(files);
			}
		};

		try {
			if (!(files instanceof Array)) files = [files];
			await checkFiles(files);
			return false;
		} catch (err) {
			if (err === 'OVER') return true;
			throw err;
		}
	}
}
