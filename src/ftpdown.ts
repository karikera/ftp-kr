
import { File } from './util/file';
import { PRIORITY_IDLE, Scheduler } from './vsutil/work';
import { WorkspaceItem, Workspace } from './vsutil/ws';
import { Config } from './config';
import { FtpCacher } from './ftpsync';
import { Logger } from './vsutil/log';

export class FtpDownloader implements WorkspaceItem
{
	private config:Config;
	private logger:Logger;
	private ftp:FtpCacher;
	private scheduler:Scheduler;

	private timer:NodeJS.Timer|null = null;
	private enabled:boolean = false;

	constructor(workspace:Workspace)
	{
		this.config = workspace.query(Config);
		this.ftp = workspace.query(FtpCacher);
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
		const ftppath = this.ftp.ftppath(dir);
		const list = await this.scheduler.task(`autoDownloadAlways.list`, PRIORITY_IDLE, task=>this.ftp.ftpList(task, ftppath));
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
					const stats = await this.scheduler.task(`autoDownloadAlways.download`, PRIORITY_IDLE, task=>this.ftp.ftpTargetStat(task, child));
					if (!stats) continue;
					child = stats;
				}
				if (child.type === 'd')
				{
					await this._downloadDir(childFile);
				}
				else
				{
					await this.scheduler.task(`autoDownloadAlways.download`, PRIORITY_IDLE, task=>this.ftp.ftpDownloadWithCheck(task, childFile));
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
