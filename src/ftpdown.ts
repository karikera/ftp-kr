
import { File } from 'krfile';

import { PRIORITY_IDLE, Scheduler } from './vsutil/work';
import { WorkspaceItem, Workspace } from './vsutil/ws';
import { Logger } from './vsutil/log';

import { Config } from './config';
import { FtpSyncManager } from './ftpsync';
import { printMappedError } from './util/sm';

export class FtpDownloader implements WorkspaceItem
{
	private readonly config:Config;
	private readonly logger:Logger;
	private readonly ftpmgr:FtpSyncManager;
	private readonly scheduler:Scheduler;

	private timer:NodeJS.Timer|null = null;
	private enabled:boolean = false;

	constructor(workspace:Workspace)
	{
		this.config = workspace.query(Config);
		this.logger = workspace.query(Logger);
		this.ftpmgr = workspace.query(FtpSyncManager);
		this.scheduler = workspace.query(Scheduler);
		this.config.onLoad(()=>this._resetTimer());
	}

	public dispose():void
	{
		if (this.timer)
		{
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.enabled = false;
	}

	private _resetTimer():void
	{
		if (this.timer)
		{
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.config.autoDownloadAlways)
		{
			this.enabled = true;
			this.timer = setTimeout(()=>this.requestDownloadAll(), this.config.autoDownloadAlways);
		}
		else
		{
			this.enabled = false;
		}
	}

	private async requestDownloadAll():Promise<void>
	{
		try
		{
			await this._downloadDir(this.config.basePath);
			if (this.enabled)
			{
				if (!this.config.autoDownloadAlways) throw Error('Assert');
				this.timer = setTimeout(()=>this.requestDownloadAll(), this.config.autoDownloadAlways);
			}
		}
		catch (err)
		{
			this.logger.error(err);
		}
	}

	private async _downloadDir(dir:File):Promise<void>
	{
		const ftppath = this.ftpmgr.targetServer.toFtpPath(dir);
		const list = await this.scheduler.taskMust(
			`downloadAlways.list`, 
			task=>this.ftpmgr.targetServer.ftpList(ftppath, task), 
			null, 
			PRIORITY_IDLE
		);
		if (!this.enabled) throw 'IGNORE';
		for (var child of list.children())
		{
			const childFile = dir.child(child.name);
			if (this.config.checkIgnorePath(dir)) continue;

			try
			{
				if (child.type === 'l')
				{
					if (!this.config.followLink) continue;
					const stats = await this.scheduler.taskMust(
						`downloadAlways.readLink`, 
						task=>this.ftpmgr.targetServer.ftpTargetStat(child, task), 
						null, 
						PRIORITY_IDLE
					);
					if (!stats) continue;
					child = stats;
				}
				if (child.type === 'd')
				{
					await this._downloadDir(childFile);
				}
				else
				{
					await this.scheduler.taskMust(
						`downloadAlways`,
						task=>this.ftpmgr.targetServer.ftpDownloadWithCheck(childFile, task),
						null,
						PRIORITY_IDLE
					);
					if (!this.enabled) throw 'IGNORE';
				}
			}
			catch(err)
			{
				printMappedError(err);
			}
		}
	}
}
