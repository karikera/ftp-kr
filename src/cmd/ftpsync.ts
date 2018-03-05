import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { File } from 'krfile';

import { VFSDirectory, VFSState } from '../util/filesystem';

import { PRIORITY_NORMAL, Scheduler } from '../vsutil/work';
import { Logger } from '../vsutil/log';
import { vsutil } from '../vsutil/vsutil';
import { Command, CommandArgs } from '../vsutil/cmd';
import { Workspace } from '../vsutil/ws';

import { ftpTree } from '../ftptree';
import { FtpSyncManager } from '../ftpsync';
import { Config } from '../config';
import { FtpCacher, BatchOptions } from '../ftpcacher';
import { openSshTerminal } from '../sshmgr';

function taskTimer<T>(taskname: string, taskpromise: Promise<T>): Promise<T> {
	const startTime = Date.now();
	return taskpromise.then(res => {
		const passedTime = Date.now() - startTime;
		if (passedTime > 1000) {
			vsutil.info(taskname + " completed");
		}
		return res;
	});
}

async function getInfoToTransfer(args: CommandArgs):Promise<{workspace:Workspace, server:FtpCacher, file:File, files:File[]}>
{
	var workspace:Workspace;
	var server:FtpCacher;
	var file:File;
	var files:File[];

	if (args.uri)
	{
		server = ftpTree.getServerFromUri(args.uri).ftp;
		workspace = server.workspace;
		file = server.fromFtpPath(args.uri.path);
		files = [file];
	}
	else if (args.treeItem)
	{
		server = args.treeItem.server.ftp;
		workspace = server.workspace;
		if (!args.treeItem.ftpFile)
		{
			file = server.mainConfig.basePath;
		}
		else
		{
			file = server.fromFtpFile(args.treeItem.ftpFile);
		}
		files = [file];
	}
	else
	{
		if (!args.file)
		{
			await vsutil.info('File is not selected');
			throw 'IGNORE';
		}
		if (!args.workspace) throw Error('workspace is not defined');
		workspace = args.workspace;
		server = workspace.query(FtpSyncManager).targetServer;
		file = args.file;
		files = args.files || [file];
	}
	return {workspace, server, file, files};
}

/**
 * return false if files not contains directory
 */
async function isFileCountOver(files:(File[]|File), count:number):Promise<boolean>
{
	async function checkFiles(files:File[]):Promise<void>
	{
		for(const file of files)
		{
			if (await file.isDirectory())
			{
				const files = await file.children();
				count -= files.length;
				if (count <= 0) throw 'OVER';
				await checkFiles(files);
			}
		}
	}

	try
	{
		if (!(files instanceof Array)) files = [files];
		checkFiles(files);
		return false;
	}
	catch (err)
	{
		if (err === 'OVER') return true;
		throw err;
	}
}

function removeChildren(files:File[]):File[]
{
	const sorted:(File|null)[] = files.slice().sort(v=>v.fsPath.length);
	for (var i=0;i<sorted.length;i++)
	{
		const parent = sorted[i];
		if (!parent) continue;
		for (var j=i+1;j<sorted.length;j++)
		{
			const child = sorted[j];
			if (!child) continue;
			if (child.in(parent))
			{
				sorted[i] = null;
			}
		}
	}
	return <File[]>sorted.filter(file=>file !== null);
}

export const commands:Command = {
	async 'ftpkr.upload' (args: CommandArgs)
	{
		var {workspace, server, files} = await getInfoToTransfer(args);
		files = removeChildren(files);

		const logger = workspace.query(Logger);
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);
		
		logger.show();

		await config.loadTest();

		const bo:BatchOptions = {
			whenRemoteModed:config.ignoreRemoteModification?'upload':'diff'
		};
		if (files.length === 1 && !await files[0].isDirectory())
		{
			await taskTimer('Upload', server.ftpUpload(files[0], null, bo));
		}
		else
		{
			bo.doNotRefresh = true;
			const confirmFirst = await isFileCountOver(files, config.noticeFileCount);
			if (confirmFirst)
			{
				bo.confirmFirst = true;
				await server.uploadAll(files, null, bo);
			}
			else
			{
				await taskTimer('Upload', server.uploadAll(files, null, bo));
			}
		}
	},
	async 'ftpkr.download' (args: CommandArgs)
	{
		const {workspace, server, files} = await getInfoToTransfer(args);
		
		const logger = workspace.query(Logger);
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);

		logger.show();
		
		await config.loadTest();

		if (files.length === 1 && !await files[0].isDirectory())
		{
			await taskTimer('Download', server.ftpDownload(files[0], null, {}));
		}
		else
		{
			const confirmFirst = await isFileCountOver(files, config.noticeFileCount);
			const bo:BatchOptions = {
				doNotRefresh: true
			};
			if (confirmFirst)
			{
				bo.confirmFirst = true;
				await server.downloadAll(files, null, bo);
			}
			else
			{
				await taskTimer('Download', server.downloadAll(files, null, bo));
			}
		}
	},
	async 'ftpkr.delete' (args: CommandArgs)
	{
		const {workspace, server, files} = await getInfoToTransfer(args);
		
		const logger = workspace.query(Logger);
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);

		logger.show();
		
		await config.loadTest();
		
		if (files.length === 1 && !await files[0].isDirectory())
		{
			await taskTimer('Delete', server.ftpDelete(files[0], null, {}));
		}
		else
		{
			const confirmFirst = await isFileCountOver(files, config.noticeFileCount);
			if (confirmFirst)
			{
				await server.deleteAll(files, null, {confirmFirst});
			}
			else
			{
				await taskTimer('Delete', server.deleteAll(files, null, {}));
			}
		}
	},
	async 'ftpkr.diff' (args: CommandArgs)
	{
		const {workspace, server, file} = await getInfoToTransfer(args);
		
		const logger = workspace.query(Logger);
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);
		const ftp = workspace.query(FtpSyncManager);
		
		logger.show();
		
		await config.loadTest();

		const isdir = await file.isDirectory();
		if (isdir) throw Error('Diff only supported for file');
	
		await server.ftpDiff(file);
	},

	async 'ftpkr.uploadAll' (args: CommandArgs)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const workspace = args.workspace;
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);
		const ftp = workspace.query(FtpSyncManager);

		await config.loadTest();
		await vscode.workspace.saveAll();

		const server = await ftp.selectServer();
		if (server === undefined) return;
		await server.uploadAll(config.basePath, null, {
			confirmFirst: true, 
			doNotRefresh: true,
			whenRemoteModed:config.ignoreRemoteModification?'upload':'error'
		});
	},
	async 'ftpkr.downloadAll' (args: CommandArgs)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const workspace = args.workspace;
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);
		const ftp = workspace.query(FtpSyncManager);

		await config.loadTest();
		await vscode.workspace.saveAll();

		const server = await ftp.selectServer();
		if (server === undefined) return;
		await server.downloadAll(config.basePath, null, {
			confirmFirst: true,
			doNotRefresh: true
		});
	},
	async 'ftpkr.cleanAll' (args: CommandArgs)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}
		
		const workspace = args.workspace;
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);
		const ftp = workspace.query(FtpSyncManager);

		await config.loadTest();
		await vscode.workspace.saveAll();
		const server = await ftp.selectServer();
		if (server === undefined) return;
		
		await server.cleanAll(config.basePath, null, {
			confirmFirst: true,
			doNotRefresh: true
		});
	},
	async 'ftpkr.refresh' (args: CommandArgs)
	{
		if (args.uri)
		{
			const server = ftpTree.getServerFromUri(args.uri).ftp;
			const ftpFile = server.toFtpFileFromFtpPath(args.uri.path);
			if (ftpFile)
			{
				ftpFile.refreshContent();
				ftpTree.refreshTree(ftpFile);
			}
		}
		else if (args.treeItem && args.treeItem.ftpFile)
		{
			const tree = args.treeItem.server;
			const workspace = tree.workspace;
			await workspace.query(Config).loadTest();

			tree.ftp.refresh(args.treeItem.ftpFile);
			args.treeItem.ftpFile.refreshContent();
			ftpTree.refreshTree(args.treeItem.ftpFile);
		}
		else for(const workspace of Workspace.all())
		{
			await workspace.query(Config).loadTest();

			const ftp = workspace.query(FtpSyncManager);
			for (const server of ftp.servers.values())
			{
				await server.fs.refreshContent();
				server.refresh();
			}
			ftpTree.refreshTree();
		}
	},

	async 'ftpkr.list' (args: CommandArgs)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}
		
		const workspace = args.workspace;
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);
		const ftp = workspace.query(FtpSyncManager);
		const selected = await ftp.selectServer();
		if (selected === undefined) return;
		
		await config.loadTest();
		await selected.list(config.basePath);
	},

	async 'ftpkr.view' (args: CommandArgs)
	{
		if (!args.uri)
		{
			if (!args.file) return vsutil.info('File is not selected');
			if (!args.workspace) throw Error('workspace is not defined');

			const file = args.file;
			const ftp = args.workspace.query(FtpSyncManager);
			const scheduler = args.workspace.query(Scheduler);
			await ftp.targetServer.init();
			const ftppath = ftp.targetServer.toFtpUrl(file);
			args.uri = Uri.parse(ftppath);
		}
		vsutil.openUri(args.uri);
	},
	
	async 'ftpkr.reconnect' (args: CommandArgs)
	{
		if (!args.workspace)
		{
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

	async 'ftpkr.runtask'(args: CommandArgs)
	{
		if (!args.file) return vsutil.info('Please select task.json file');
		if (!args.workspace) throw Error('workspace is not defined');
		
		if (args.file.ext() !== '.json')
		{
			return vsutil.info('Please select task.json file');
		}
		const workspace = args.workspace;
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);
		const ftp = workspace.query(FtpSyncManager);

		await config.loadTest();
		await vscode.workspace.saveAll();
		
		const path = args.file;
		ftp.runTaskJson('ftpkr.runtask', path, {
			whenRemoteModed:config.ignoreRemoteModification?'upload':'error'
		});
	},
	
	async 'ftpkr.target'(args: CommandArgs)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const ftp = args.workspace.query(FtpSyncManager);
		const server = await ftp.selectServer(true);
		if (!server) return;
		ftp.targetServer = server;
	},
	
	async 'ftpkr.ssh'(args: CommandArgs)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const ftp = args.workspace.query(FtpSyncManager);
		const server = await ftp.selectServer();
		if (!server) return;

		openSshTerminal(server);
	}
};
