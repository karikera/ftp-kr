import * as vscode from 'vscode';


import { PRIORITY_NORMAL, Scheduler } from '../vsutil/work';
import { Logger } from '../vsutil/log';
import { FtpSyncManager } from '../ftpsync';
import { Config } from '../config';
import { vsutil } from '../vsutil/vsutil';
import { Command, CommandArgs } from '../vsutil/cmd';

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

export const commands:Command = {
	async 'ftpkr.upload' (args: CommandArgs)
	{
		if (!args.file) return vsutil.info('File is not selected');
		if (!args.workspace) throw Error('workspace is not defined');

		const logger = args.workspace.query(Logger);
		const config = args.workspace.query(Config);
		const scheduler = args.workspace.query(Scheduler);
		const ftp = args.workspace.query(FtpSyncManager);
		
		logger.show();

		await config.loadTest();

		const path = args.file;
		await scheduler.task('ftpkr.upload', PRIORITY_NORMAL, async(task) => {
			const isdir = await path.isDirectory();
			if (isdir)
			{
				await ftp.uploadAll(task, path);
			}
			else
			{
				await taskTimer('Upload', ftp.upload(task, path, {doNotMakeDirectory:true, forceUpload:true}));
			}
		});
	},
	async 'ftpkr.download' (args: CommandArgs)
	{
		if (!args.file) return vsutil.info('File is not selected');
		if (!args.workspace) throw Error('workspace is not defined');

		const logger = args.workspace.query(Logger);
		const config = args.workspace.query(Config);
		const scheduler = args.workspace.query(Scheduler);
		const ftp = args.workspace.query(FtpSyncManager);

		logger.show();
		
		await config.loadTest();

		const path = args.file;
		await scheduler.task('ftpkr.download', PRIORITY_NORMAL, async (task) => {
			const isdir = await path.isDirectory();
			if (isdir)
			{
				await ftp.downloadAll(task, path);
			}
			else
			{
				await taskTimer('Download', ftp.download(task, path))
			}
		});
	},
	async 'ftpkr.diff' (args: CommandArgs)
	{
		if (!args.file) return vsutil.info('File is not selected');
		if (!args.workspace) throw Error('workspace is not defined');

		const logger = args.workspace.query(Logger);
		const config = args.workspace.query(Config);
		const scheduler = args.workspace.query(Scheduler);
		const ftp = args.workspace.query(FtpSyncManager);
		
		logger.show();
		
		await config.loadTest();

		const path = args.file;
		const isdir = await path.isDirectory();
		if (isdir) throw Error('Diff only supported for file');

		await scheduler.task('ftpkr.diff', PRIORITY_NORMAL, task => taskTimer('Diff', ftp.diff(task, path)));
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
		await scheduler.taskWithTimeout('ftpkr.uploadAll', PRIORITY_NORMAL, 1000, task => ftp.uploadAll(task, config.basePath));
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
		await scheduler.taskWithTimeout('ftpkr.downloadAll', PRIORITY_NORMAL, 1000, task => ftp.downloadAll(task, config.basePath));
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
		await scheduler.taskWithTimeout('ftpkr.cleanAll', PRIORITY_NORMAL, 1000, async (task) => ftp.cleanAll(task));
	},
	async 'ftpkr.refreshAll' (args: CommandArgs)
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
		await scheduler.taskWithTimeout('ftpkr.refreshAll', PRIORITY_NORMAL, 1000, task => ftp.refreshForce(task));
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
		throw Error ('Not implemented yet');
		// if (args.uri)
		// {
		// 	vscode.workspace.openTextDocument(args.uri).then(document => {
		// 		vscode.window.showTextDocument(document);
		// 	});
		// }
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
};
