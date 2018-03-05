
import { File } from "krfile";

import { VirtualFileSystem } from "./util/filesystem";
import { ServerConfig } from "./util/serverinfo";

import { WorkspaceItem, Workspace } from "./vsutil/ws";
import { Logger } from "./vsutil/log";
import { QuickPick } from "./vsutil/vsutil";
import { Task, Scheduler } from "./vsutil/work";

import { Config } from "./config";
import { FtpCacher, BatchOptions, UploadReport } from "./ftpcacher";
import { ftpTree } from "./ftptree";


export class FtpSyncManager implements WorkspaceItem
{
	private readonly logger:Logger;
	private readonly config:Config;
	private readonly scheduler:Scheduler;
	private readonly cacheFile:File;
	public readonly servers:Map<ServerConfig, FtpCacher> = new Map;
	private readonly fs:VirtualFileSystem = new VirtualFileSystem;
	public targetServer:FtpCacher = <any>null;
	public mainServer:FtpCacher = <any>null;
	
	constructor(public readonly workspace:Workspace)
	{
		this.logger = workspace.query(Logger);
		this.config = workspace.query(Config);
		this.scheduler = workspace.query(Scheduler);
		this.cacheFile = this.workspace.child('.vscode/ftp-kr.sync.cache.json');

		this.fs.onRefreshContent(file=>ftpTree.refreshContent(file));
		this.fs.onRefreshTree(file=>ftpTree.refreshTree(file));
	}

	private _getServerFromIndex(index:number):FtpCacher
	{
		if (index > 0 && index <= this.config.altServer.length)
		{
			const server = this.servers.get(this.config.altServer[index-1]);
			if (server) return server;
		}
		const server = this.servers.get(this.config);
		if (!server) throw Error('Main server not found');
		return server;
	}

	public clear():void
	{
		for (const server of this.servers.values())
		{
			ftpTree.removeServer(server);
			server.terminate();
		}
		this.servers.clear();
		this.mainServer = <any>null;
		this.targetServer = <any>null;
	}

	public async onLoadConfig(task:Task):Promise<void>
	{
		var targetServerIndex = this.targetServer ? this.targetServer.config.index : 0;
		try
		{
			if (this.config.createSyncCache)
			{
				const extra = await this.fs.load(this.cacheFile, '');
				if ("$targetServer" in extra) targetServerIndex = Number(extra.$targetServer || 0);
			}
		}
		catch (err)
		{
		}
		
		this.clear();
		
		const mainServer = new FtpCacher(this.workspace, this.config, this.fs);
		this.servers.set(this.config, mainServer);
		this.mainServer = mainServer;

		ftpTree.addServer(mainServer);

		for (const config of this.config.altServer)
		{
			const server = new FtpCacher(this.workspace, config, this.fs);
			this.servers.set(config, server);
			ftpTree.addServer(server);
		}

		ftpTree.refreshTree();
		this.targetServer = this._getServerFromIndex(targetServerIndex) || mainServer;
	}

	public onNotFoundConfig():void
	{
		this.clear();
		ftpTree.refreshTree();
	}

	public dispose():void
	{
		try
		{
			if (this.config.createSyncCache)
			{
				const using = new Set<string|undefined>();
				for (const config of this.servers.keys())
				{
					using.add(config.hostUrl);
				}
				for (const server of this.fs.children())
				{
					if (using.has(server.name)) continue;
					this.fs.deleteItem(server.name);
				}

				var extra:any = {};
				if (this.targetServer.config !== this.config)
				{
					const targetServerUrl = this.targetServer.config.index;
					if (targetServerUrl) extra.$targetServer = targetServerUrl;
				}
				this.fs.save(this.cacheFile, extra);
			}
			for (const server of this.servers.values())
			{
				ftpTree.removeServer(server);
				server.terminate();
			}
			this.servers.clear();
		}
		catch(err)
		{
			console.error(err);
		}
	}

	public async selectServer(openAlways?:boolean):Promise<FtpCacher|undefined>
	{
		var selected:FtpCacher|undefined = undefined;
		const pick = new QuickPick;
		for (const server of this.servers.values())
		{
			const config = server.config;
			var name:string;
			if (server.config === this.config) name = 'Main Server';
			else name = config.name || config.host;
			if (server === this.targetServer) name += ' *';
			pick.item(name, ()=>{ selected = this.servers.get(config); });
		}
		if (!openAlways && pick.items.length === 1)
		{
			pick.items[0].onselect();
		}
		else
		{
			if (pick.items.length === 0) throw Error('Server not found');
			await pick.open();
		}
		return selected;
	}

	public reconnect(task?:Task|null):Promise<void>
	{
		return this.scheduler.taskMust('Reconnect', task => {
			this.targetServer.terminate();
			return this.targetServer.init(task);
		}, task);
	}

	public async runTaskJson(taskName:string, taskjson:File, options:BatchOptions):Promise<void>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return;
		const tasks = await taskjson.json();
		await selected.runTaskJsonWithConfirm(taskName, tasks, taskjson.basename(), taskjson.parent(), options);
	}
}
