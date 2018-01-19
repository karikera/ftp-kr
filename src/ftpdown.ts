
import * as ws from './vsutil/ws';
import * as log from './vsutil/log';
import * as work from './vsutil/work';
import * as cfg from './config';

import * as ftp from './ftpsync';
import {File} from './util/file';

export class FtpDownloader implements ws.WorkspaceItem
{
	private config:cfg.Config;
	private logger:log.Logger;
	private ftp:ftp.FtpCacher;
	private scheduler:work.Scheduler;

	private timer:NodeJS.Timer|null = null;
	private enabled:boolean = false;

	constructor(workspace:ws.Workspace)
	{
		this.config = workspace.query(cfg.Config);
		this.ftp = workspace.query(ftp.FtpCacher);
		this.scheduler = workspace.query(work.Scheduler);
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
		const ftppath = this.ftp.ftppath(dir);
		const list = await this.scheduler.task(`autoDownloadAlways.list`, work.IDLE, task=>this.ftp.ftpList(task, ftppath));
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
					const stats = await this.scheduler.task(`autoDownloadAlways.download`, work.IDLE, task=>this.ftp.ftpTargetStat(task, child));
					if (!stats) continue;
					child = stats;
				}
				if (child.type === 'd')
				{
					await this._downloadDir(childFile);
				}
				else
				{
					await this.scheduler.task(`autoDownloadAlways.download`, work.IDLE, task=>this.ftp.ftpDownloadWithCheck(task, childFile));
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
