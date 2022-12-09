import { File } from 'krfile';
import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { Config } from '../config';
import { BatchOptions, FtpCacher } from '../ftpcacher';
import { FtpSyncManager } from '../ftpsync';
import { ftpTree } from '../ftptree';
import { openSshTerminal } from '../sshmgr';
import { ftp_path } from '../util/ftp_path';
import { Command, CommandArgs } from '../vsutil/cmd';
import { Logger, StringError } from '../vsutil/log';
import { vsutil } from '../vsutil/vsutil';
import { Scheduler } from '../vsutil/work';
import { Workspace } from '../vsutil/ws';

interface SelectedFiles {
	workspace: Workspace;
	server: FtpCacher;
	file: File;
	files: File[];
	isFtpExplorer: boolean;
}

async function getSelectedFiles(args: CommandArgs): Promise<SelectedFiles> {
	let workspace: Workspace;
	let server: FtpCacher;
	let file: File;
	let files: File[];
	let isFtpExplorer = false;

	if (args.uri) {
		server = ftpTree.getServerFromUri(args.uri).ftp;
		workspace = server.workspace;
		file = server.fromFtpPath(args.uri.path);
		files = [file];
		isFtpExplorer = true;
	} else if (args.treeItem) {
		server = args.treeItem.server.ftp;
		workspace = server.workspace;
		if (!args.treeItem.ftpFile) {
			file = server.mainConfig.getBasePath();
		} else {
			file = server.fromFtpFile(args.treeItem.ftpFile);
		}
		files = [file];
	} else {
		if (!args.file) {
			vsutil.info('File is not selected');
			throw StringError.IGNORE;
		}
		if (!args.workspace) throw Error('workspace is not defined');
		workspace = args.workspace;
		server = workspace.query(FtpSyncManager).targetServer;
		file = args.file;
		files = args.files || [file];
	}
	return { workspace, server, file, files, isFtpExplorer };
}

/**
 * return false if files not contains directory
 */
async function isFileCountOver(
	files: File[] | File,
	count: number
): Promise<boolean> {
	async function checkFiles(files: File[]): Promise<void> {
		for (const file of files) {
			if (await file.isDirectory()) {
				const files = await file.children();
				count -= files.length;
			}
			count--;
			if (count <= 0) throw 'OVER';
			await checkFiles(files);
		}
	}

	try {
		if (!(files instanceof Array)) files = [files];
		await checkFiles(files);
		return false;
	} catch (err) {
		if (err === 'OVER') return true;
		throw err;
	}
}

function removeChildren(files: File[]): File[] {
	const sorted: (File | null)[] = files.slice().sort((v) => v.fsPath.length);
	for (let i = 0; i < sorted.length; i++) {
		const parent = sorted[i];
		if (!parent) continue;
		for (let j = i + 1; j < sorted.length; j++) {
			const child = sorted[j];
			if (!child) continue;
			if (child.in(parent)) {
				sorted[i] = null;
			}
		}
	}
	return <File[]>sorted.filter((file) => file !== null);
}

async function getFileNameFromInput(
	server: FtpCacher,
	files: File[]
): Promise<string> {
	if (files.length !== 1)
		throw Error(`Invalid selected file count: ${files.length}`);

	const file = files[0];
	const ftppath = server.toFtpPath(file);
	const stat = await server.ftpStat(ftppath);

	let parentFtppath = '';
	if (stat === undefined) throw Error(`File not found: ${ftppath}`);
	if (stat.type === 'd') {
		parentFtppath = ftppath;
		vscode.commands.executeCommand('list.expand');
	} else {
		parentFtppath = ftp_path.dirname(ftppath);
	}
	if (parentFtppath === '/') parentFtppath = '';
	const fileName = await vscode.window.showInputBox({
		prompt: 'File Name',
	});
	if (fileName === undefined) throw StringError.IGNORE;
	return parentFtppath + '/' + fileName;
}

export const commands: Command = {
	async 'ftpkr.new'(args: CommandArgs) {
		const { workspace, server, files } = await getSelectedFiles(args);
		const logger = workspace.query(Logger);
		const config = workspace.query(Config);

		await config.loadTest();

		const ftppath = await getFileNameFromInput(server, files);
		logger.show();
		await server.uploadBuffer(ftppath, Buffer.alloc(0));
	},
	async 'ftpkr.mkdir'(args: CommandArgs) {
		const { workspace, server, files } = await getSelectedFiles(args);
		const logger = workspace.query(Logger);
		const config = workspace.query(Config);

		await config.loadTest();

		const ftppath = await getFileNameFromInput(server, files);
		logger.show();
		await server.ftpMkdir(ftppath);
	},
	async 'ftpkr.upload'(args: CommandArgs) {
		const { workspace, server, files: files_ } = await getSelectedFiles(args);
		const files = removeChildren(files_);

		const logger = workspace.query(Logger);
		const config = workspace.query(Config);

		logger.show();
		await config.loadTest();

		const bo: BatchOptions = {
			whenRemoteModed: config.ignoreRemoteModification ? 'upload' : 'diff',
			skipModCheck: config.includeAllAlwaysForAllCommand,
		};
		if (files.length === 1 && !(await files[0].isDirectory())) {
			await config.reportTaskCompletionPromise(
				'Upload',
				server.ftpUpload(files[0], null, bo)
			);
		} else {
			bo.doNotRefresh = true;
			const confirmFirst = await isFileCountOver(files, config.noticeFileCount);
			if (confirmFirst) {
				bo.confirmFirst = true;
				await server.uploadAll(files, null, bo);
			} else {
				await config.reportTaskCompletionPromise(
					'Upload',
					server.uploadAll(files, null, bo)
				);
			}
		}
	},
	async 'ftpkr.download'(args: CommandArgs) {
		const { workspace, server, files } = await getSelectedFiles(args);

		const logger = workspace.query(Logger);
		const config = workspace.query(Config);

		logger.show();

		await config.loadTest();

		const bo: BatchOptions = {
			skipModCheck: config.includeAllAlwaysForAllCommand,
		};
		if (files.length === 1) {
			const ftppath = server.toFtpPath(files[0]);
			const ftpFile = await server.ftpStat(ftppath);
			if (ftpFile === undefined) throw Error(`file not found: ${ftppath}`);
			if (ftpFile.type !== 'd') {
				await config.reportTaskCompletionPromise(
					'Download',
					server.ftpDownload(files[0], null, bo)
				);
				return;
			}
		}
		const confirmFirst = await server.isFileCountOver(
			files,
			config.noticeFileCount
		);
		bo.doNotRefresh = true;
		if (confirmFirst) {
			bo.confirmFirst = true;
			await server.downloadAll(files, null, bo);
		} else {
			await config.reportTaskCompletionPromise(
				'Download',
				server.downloadAll(files, null, bo)
			);
		}
	},
	async 'ftpkr.delete'(args: CommandArgs) {
		const { workspace, server, files } = await getSelectedFiles(args);

		const logger = workspace.query(Logger);
		const config = workspace.query(Config);

		logger.show();

		await config.loadTest();

		const opts: BatchOptions = {
			skipIgnoreChecking: true,
		};
		if (files.length === 1) {
			const ftppath = server.toFtpPath(files[0]);
			const ftpFile = await server.ftpStat(ftppath);
			if (ftpFile === undefined) throw Error(`file not found: ${ftppath}`);
			if (ftpFile.type !== 'd') {
				await config.reportTaskCompletionPromise(
					'Delete',
					server.ftpDelete(ftppath, null, opts)
				);
				return;
			}
		}
		const confirmFirst = await server.isFileCountOver(
			files,
			config.noticeFileCount
		);
		if (confirmFirst) {
			await server.deleteAll(files, null, { confirmFirst });
		} else {
			await config.reportTaskCompletionPromise(
				'Delete',
				server.deleteAll(files, null, opts)
			);
		}
	},
	async 'ftpkr.diff'(args: CommandArgs) {
		const { workspace, server, file } = await getSelectedFiles(args);

		const logger = workspace.query(Logger);
		const config = workspace.query(Config);

		logger.show();

		await config.loadTest();

		const isdir = await file.isDirectory();
		if (isdir) throw Error('Diff only supported for file');

		await server.ftpDiff(file);
	},

	async 'ftpkr.uploadAll'(args: CommandArgs) {
		if (!args.workspace) {
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const workspace = args.workspace;
		const config = workspace.query(Config);
		const ftp = workspace.query(FtpSyncManager);

		await config.loadTest();
		await vscode.workspace.saveAll();

		const server = await ftp.selectServer();
		if (server === undefined) return;
		await server.uploadAll(config.getBasePath(), null, {
			confirmFirst: true,
			doNotRefresh: true,
			whenRemoteModed: config.ignoreRemoteModification ? 'upload' : 'error',
			skipModCheck: config.includeAllAlwaysForAllCommand,
		});
	},
	async 'ftpkr.downloadAll'(args: CommandArgs) {
		if (!args.workspace) {
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const workspace = args.workspace;
		const config = workspace.query(Config);
		const ftp = workspace.query(FtpSyncManager);

		await config.loadTest();
		await vscode.workspace.saveAll();

		const server = await ftp.selectServer();
		if (server === undefined) return;
		await server.downloadAll(config.getBasePath(), null, {
			confirmFirst: true,
			doNotRefresh: true,
			skipModCheck: config.includeAllAlwaysForAllCommand,
		});
	},
	async 'ftpkr.cleanAll'(args: CommandArgs) {
		if (!args.workspace) {
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const workspace = args.workspace;
		const config = workspace.query(Config);
		const ftp = workspace.query(FtpSyncManager);

		await config.loadTest();
		await vscode.workspace.saveAll();
		const server = await ftp.selectServer();
		if (server === undefined) return;

		await server.cleanAll(config.getBasePath(), null, {
			confirmFirst: true,
			doNotRefresh: true,
		});
	},
	async 'ftpkr.refresh'(args: CommandArgs) {
		if (args.uri) {
			const server = ftpTree.getServerFromUri(args.uri).ftp;
			const ftpFile = server.toFtpFileFromFtpPath(args.uri.path);
			if (ftpFile) {
				ftpTree.refreshTree(ftpFile);
			}
		} else if (args.treeItem && args.treeItem.ftpFile) {
			const tree = args.treeItem.server;
			const workspace = tree.workspace;
			await workspace.query(Config).loadTest();

			tree.ftp.refresh(args.treeItem.ftpFile);
			ftpTree.refreshTree(args.treeItem.ftpFile);
		} else
			for (const workspace of Workspace.all()) {
				await workspace.query(Config).loadTest();

				const ftp = workspace.query(FtpSyncManager);
				for (const server of ftp.servers.values()) {
					server.refresh();
				}
				ftpTree.refreshTree();
			}
	},

	async 'ftpkr.list'(args: CommandArgs) {
		if (!args.workspace) {
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const workspace = args.workspace;
		const config = workspace.query(Config);
		const ftp = workspace.query(FtpSyncManager);
		const selected = await ftp.selectServer();
		if (selected === undefined) return;

		await config.loadTest();
		await selected.list(config.getBasePath());
	},

	async 'ftpkr.view'(args: CommandArgs) {
		if (!args.uri) {
			if (!args.file) return vsutil.info('File is not selected');
			if (!args.workspace) throw Error('workspace is not defined');

			const file = args.file;
			const ftp = args.workspace.query(FtpSyncManager);
			await ftp.targetServer.init();
			const ftppath = ftp.targetServer.toFtpUrl(file);
			args.uri = Uri.parse(ftppath);
		}
		vsutil.openUri(args.uri);
	},

	async 'ftpkr.reconnect'(args: CommandArgs) {
		if (!args.workspace) {
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const workspace = args.workspace;
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);
		const ftp = workspace.query(FtpSyncManager);

		await config.loadTest();
		await scheduler.cancel();
		await ftp.reconnect();
	},

	async 'ftpkr.runtask'(args: CommandArgs) {
		if (!args.file) return vsutil.info('Please select task.json file');
		if (!args.workspace) throw Error('workspace is not defined');

		if (args.file.ext() !== '.json') {
			return vsutil.info('Please select task.json file');
		}
		const workspace = args.workspace;
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);
		const ftp = workspace.query(FtpSyncManager);

		await config.loadTest();
		await vscode.workspace.saveAll();

		const path = args.file;
		scheduler.task('ftpkr.runtask', () =>
			ftp.runTaskJson('ftpkr.runtask', path, {
				whenRemoteModed: config.ignoreRemoteModification ? 'upload' : 'error',
				parentDirectory: path.parent(),
			})
		);
	},

	async 'ftpkr.target'(args: CommandArgs) {
		if (!args.workspace) {
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const ftp = args.workspace.query(FtpSyncManager);
		const server = await ftp.selectServer(true);
		if (!server) return;
		ftp.targetServer = server;
	},

	async 'ftpkr.ssh'(args: CommandArgs) {
		if (!args.workspace) {
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const ftp = args.workspace.query(FtpSyncManager);
		const server = await ftp.selectServer();
		if (!server) return;

		openSshTerminal(server);
	},
};
