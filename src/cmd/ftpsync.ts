import * as vscode from 'vscode';

import * as cmd from '../vsutil/cmd';
import * as vsutil from '../vsutil/vsutil';
import * as log from '../vsutil/log';
import * as work from '../vsutil/work';
import * as ws from '../vsutil/ws';

import * as ftpsync from '../ftpsync';
import * as cfg from '../config';

function taskTimer(taskname: string, taskpromise: Promise<void>): Promise<void> {
	const startTime = Date.now();
	return taskpromise.then(() => {
		const passedTime = Date.now() - startTime;
		if (passedTime > 1000) {
			vsutil.info(taskname + " completed");
		}
	});
}

export const commands:cmd.Command = {
	async 'ftpkr.upload' (args: cmd.Args)
	{
		if (!args.file) return vsutil.info('File is not selected');
		if (!args.workspace) throw Error('workspace is not defined');

		const logger = args.workspace.query(log.Logger);
		const config = args.workspace.query(cfg.Config);
		const scheduler = args.workspace.query(work.Scheduler);
		const ftp = args.workspace.query(ftpsync.FtpSyncManager);
		logger.show();

		await config.loadTest();

		const path = args.file;
		scheduler.task('ftpkr.upload', async(task) => {
			const isdir = await path.isDirectory();
			if (isdir)
			{
				await ftp.uploadAll(task, path);
			}
			else
			{
				await taskTimer('Upload', ftp.upload(task, path, {doNotMakeDirectory:true}).then(res => {
					if (res.latestIgnored)
					{
						logger.message(`latest: ${ws.workpath(path)}`);
					}
				}));
			}
		});
	},
	async 'ftpkr.download' (args: cmd.Args)
	{
		if (!args.file) return vsutil.info('File is not selected');
		if (!args.workspace) throw Error('workspace is not defined');

		const logger = args.workspace.query(log.Logger);
		const config = args.workspace.query(cfg.Config);
		const scheduler = args.workspace.query(work.Scheduler);
		const ftp = args.workspace.query(ftpsync.FtpSyncManager);
		logger.show();
		
		await config.loadTest();

		const path = args.file;
		scheduler.task('ftpkr.download', async (task) => {
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

	async 'ftpkr.uploadAll' (args: cmd.Args)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const workspace = args.workspace;
		const config = workspace.query(cfg.Config);
		const scheduler = workspace.query(work.Scheduler);
		const ftp = workspace.query(ftpsync.FtpSyncManager);

		await config.loadTest();
		await vscode.workspace.saveAll();
		scheduler.taskWithTimeout('ftpkr.uploadAll', 1000, task => ftp.uploadAll(task, workspace));
	},
	async 'ftpkr.downloadAll' (args: cmd.Args)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}

		const workspace = args.workspace;
		const config = workspace.query(cfg.Config);
		const scheduler = workspace.query(work.Scheduler);
		const ftp = workspace.query(ftpsync.FtpSyncManager);

		await config.loadTest();
		await vscode.workspace.saveAll();
		scheduler.taskWithTimeout('ftpkr.downloadAll', 1000, task => ftp.downloadAll(task, workspace));
	},
	async 'ftpkr.cleanAll' (args: cmd.Args)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}
		
		const workspace = args.workspace;
		const config = workspace.query(cfg.Config);
		const scheduler = workspace.query(work.Scheduler);
		const ftp = workspace.query(ftpsync.FtpSyncManager);

		await config.loadTest();
		await vscode.workspace.saveAll();
		scheduler.taskWithTimeout('ftpkr.cleanAll', 1000, async (task) => ftp.cleanAll(task));
	},
	async 'ftpkr.refreshAll' (args: cmd.Args)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}
		
		const workspace = args.workspace;
		const config = workspace.query(cfg.Config);
		const scheduler = workspace.query(work.Scheduler);
		const ftp = workspace.query(ftpsync.FtpSyncManager);

		await config.loadTest();
		scheduler.taskWithTimeout('ftpkr.refreshAll', 1000, task => ftp.refreshForce(task));
	},

	async 'ftpkr.list' (args: cmd.Args)
	{
		if (!args.workspace)
		{
			args.workspace = await vsutil.selectWorkspace();
			if (!args.workspace) return;
		}
		
		const workspace = args.workspace;
		const config = workspace.query(cfg.Config);
		const scheduler = workspace.query(work.Scheduler);
		const ftp = workspace.query(ftpsync.FtpSyncManager);

		await config.loadTest();
		scheduler.taskWithTimeout('ftpkr.list', 1000, task => ftp.list(task, workspace));
	},
};
