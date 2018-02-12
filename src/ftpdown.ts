
import { File } from 'krfile';

import { PRIORITY_IDLE, Scheduler } from './vsutil/work';
import { WorkspaceItem, Workspace } from './vsutil/ws';
import { Logger } from './vsutil/log';

import { Config } from './config';
import { FtpSyncManager } from './ftpsync';

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
		const list = await this.scheduler.task(`autoDownloadAlways.list`, PRIORITY_IDLE, task=>this.ftpmgr.targetServer.ftpList(task, ftppath));
		if (!this.enabled) throw 'IGNORE';
		for (const childName in list.files)
		{
			switch(childName)
			{
			case '': case '.': case '..': continue;
			}
			const _child = list.files[childName];
			if (!_child) continue;
			var child = _child;
			const childFile = dir.child(childName);
			if (this.config.checkIgnorePath(dir)) continue;

			try
			{
				if (child.type === 'l')
				{
					if (!this.config.followLink) continue;
					const stats = await this.scheduler.task(`autoDownloadAlways.download`, PRIORITY_IDLE, task=>this.ftpmgr.targetServer.ftpTargetStat(task, child));
					if (!stats) continue;
					child = stats;
				}
				if (child.type === 'd')
				{
					await this._downloadDir(childFile);
				}
				else
				{
					await this.scheduler.task(`autoDownloadAlways.download`, PRIORITY_IDLE, task=>this.ftpmgr.targetServer.ftpDownloadWithCheck(task, childFile));
					if (!this.enabled) throw 'IGNORE';
				}
			}
			catch(err)
			{
				console.error(err);
			}
		}
	}
}
