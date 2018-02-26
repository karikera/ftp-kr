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

		const isdir = await file.isDirectory();
		if (isdir)
		{
			await server.uploadAll(file);
		}
		else
		{
			await server.ftpUpload(file, null, {whenRemoteModed:config.ignoreRemoteModification?'upload':'diff'});
		}
	},
	async 'ftpkr.download' (args: CommandArgs)
	{
		const {workspace, server, file} = await getInfoToTransfer(args);
		
		const logger = workspace.query(Logger);
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);

		logger.show();
		
		await config.loadTest();

		const isdir = await file.isDirectory();
		if (isdir)
		{
			await server.downloadAll(file);
		}
		else
		{
			await taskTimer('Download', server.ftpDownload(file));
		}
	},
	async 'ftpkr.delete' (args: CommandArgs)
	{
		const {workspace, server, file} = await getInfoToTransfer(args);
		
		const logger = workspace.query(Logger);
		const config = workspace.query(Config);
		const scheduler = workspace.query(Scheduler);

		logger.show();
		
		await config.loadTest();
		await taskTimer('Delete', server.ftpDelete(file));
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
		await server.uploadAll(config.basePath);
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
		await server.downloadAll(config.basePath);
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
		await server.cleanAll();
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
				server.fs.refreshContent();
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
			await ftp.targetServer.initForRemotePath();
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
		ftp.runTaskJson('ftpkr.runtask', path);
	},
	
	async 'ftpkr.target'(args: CommandArgs)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const ftp = args.workspace.query(FtpSyncManager);
		const server = await ftp.selectServer();
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
