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
import { FtpCacher } from '../ftpcacher';

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

async function getInfoToTransfer(args: CommandArgs):Promise<{workspace:Workspace, server:FtpCacher, file:File}>
{
	var workspace:Workspace;
	var server:FtpCacher;
	var file:File;

	if (args.uri)
	{
		server = ftpTree.getServerFromUri(args.uri).ftp;
		workspace = server.workspace;
		file = server.fromFtpPath(args.uri.path);
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
	}
	return {workspace, server, file};
}

export const commands:Command = {
	async 'ftpkr.upload' (args: CommandArgs)
	{
		const {workspace, server, file} = await getInfoToTransfer(args);

		const logger = workspace.query(Logger);
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);
		
		logger.show();

		await config.loadTest();

		const ftpFile = server.toFtpFile(file);
		const parentFtpFile = server.toFtpFile(file.parent());
		await scheduler.task('ftpkr.upload', PRIORITY_NORMAL, async (task) => {
			const isdir = await file.isDirectory();
			if (isdir)
			{
				await server.uploadAll(task, file);
			}
			else
			{
				await taskTimer('Upload', server.ftpUpload(task, file, {whenRemoteModed:config.ignoreRemoteModification?'upload':'diff'}));
			}
		});
		if (ftpFile) ftpTree.refresh(ftpFile);
		if (parentFtpFile) ftpTree.refresh(parentFtpFile);
	},
	async 'ftpkr.download' (args: CommandArgs)
	{
		const {workspace, server, file} = await getInfoToTransfer(args);
		
		const logger = workspace.query(Logger);
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);

		logger.show();
		
		await config.loadTest();

		await scheduler.task('ftpkr.download', PRIORITY_NORMAL, async (task) => {
			const isdir = await file.isDirectory();
			if (isdir)
			{
				await server.downloadAll(task, file);
			}
			else
			{
				await taskTimer('Download', server.ftpDownload(task, file))
			}
		});
	},
	async 'ftpkr.delete' (args: CommandArgs)
	{
		const {workspace, server, file} = await getInfoToTransfer(args);
		
		const logger = workspace.query(Logger);
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);

		logger.show();
		
		await config.loadTest();

		const ftpFile = server.toFtpFile(file);
		const parentFtpFile = server.toFtpFile(file.parent());
		await scheduler.task('ftpkr.delete', PRIORITY_NORMAL, 
			task => taskTimer('Delete', server.ftpDelete(task, file)));
		if (ftpFile) ftpTree.refresh(ftpFile);
		if (parentFtpFile) ftpTree.refresh(parentFtpFile);
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
	
		await scheduler.task('ftpkr.diff', PRIORITY_NORMAL, task => taskTimer('Diff', server.ftpDiff(task, file)));
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
		const server = await scheduler.taskWithTimeout('ftpkr.uploadAll', PRIORITY_NORMAL, 1000, 
			task => ftp.uploadAll(task, config.basePath));
		ftpTree.refreshContent();
		if (server) ftpTree.refresh(server.fs);
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
		await scheduler.taskWithTimeout('ftpkr.downloadAll', PRIORITY_NORMAL, 1000, 
			task => ftp.downloadAll(task, config.basePath));
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
		const server = await scheduler.taskWithTimeout('ftpkr.cleanAll', PRIORITY_NORMAL, 1000, 
			task => ftp.cleanAll(task));
		if (server) ftpTree.refresh(server.fs);
	},
	async 'ftpkr.refresh' (args: CommandArgs)
	{
		if (args.uri)
		{
			const server = ftpTree.getServerFromUri(args.uri).ftp;
			const ftpFile = server.toFtpFileFromFtpPath(args.uri.path);
			if (ftpFile)
			{
				ftpTree.refresh(ftpFile);
			}
		}
		if (args.treeItem && args.treeItem.ftpFile)
		{
			const tree = args.treeItem.server;
			const workspace = tree.workspace;
			await workspace.query(Config).loadTest();

			tree.ftp.refresh(args.treeItem.ftpFile);
			ftpTree.refresh(args.treeItem.ftpFile);
		}
		else for(const workspace of Workspace.all())
		{
			await workspace.query(Config).loadTest();

			const ftp = workspace.query(FtpSyncManager);
			for (const server of ftp.servers.values())
			{
				server.refresh(server.home);
				ftpTree.refresh(server.home);
			}
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

		await config.loadTest();
		await scheduler.taskWithTimeout('ftpkr.list', PRIORITY_NORMAL, 1000, task => ftp.list(task, config.basePath));
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
			await scheduler.task('ftpkr.view', PRIORITY_NORMAL, task => ftp.targetServer.initForRemotePath(task));
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
		scheduler.cancel();
		await scheduler.task('ftpkr.reconnect', PRIORITY_NORMAL, task => ftp.reconnect(task));
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
		await scheduler.taskWithTimeout('ftpkr.runtask', PRIORITY_NORMAL, 1000, task => ftp.runTaskJson(task, path));
	},
	
	async 'ftpkr.target'(args: CommandArgs)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const ftp = args.workspace.query(FtpSyncManager);
		await ftp.selectTarget();
	}
};
