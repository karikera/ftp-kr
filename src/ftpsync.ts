
import { VirtualFileSystem } from "./util/filesystem";

import { WorkspaceItem, Workspace } from "./vsutil/ws";
import { Logger } from "./vsutil/log";
import { QuickPick } from "./vsutil/vsutil";
import { Task } from "./vsutil/work";

import { Config } from "./config";
import { File } from "krfile";
import { FtpCacher, BatchOptions, UploadReport } from "./ftpcacher";
import { ftpTree } from "./ftptree";
import { ServerConfig } from "./util/fileinfo";


export class FtpSyncManager implements WorkspaceItem
{
	private readonly logger:Logger;
	private readonly config:Config;
	private readonly cacheFile:File;
	public readonly servers:Map<ServerConfig, FtpCacher> = new Map;
	private readonly fs:VirtualFileSystem = new VirtualFileSystem;
	public targetServer:FtpCacher;
	
	constructor(public readonly workspace:Workspace)
	{
		this.logger = workspace.query(Logger);
		this.config = workspace.query(Config);
		this.cacheFile = this.workspace.child('.vscode/ftp-kr.sync.cache.json');

		this.targetServer = <any>undefined;
	}

	private _clearServer()
	{
		for (const server of this.servers.values())
		{
			ftpTree.removeServer(server);
			server.terminate();
		}
		this.servers.clear();
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
		
		this._clearServer();


		const mainServer = new FtpCacher(this.workspace, this.config, this.fs);
		this.servers.set(this.config, mainServer);
		ftpTree.addServer(mainServer);
		await mainServer.init(task);

		for (const config of this.config.altServer)
		{
			const server = new FtpCacher(this.workspace, config, this.fs);
			this.servers.set(config, server);
			ftpTree.addServer(server);
		}

		this.targetServer = this._getServerFromIndex(targetServerIndex) || mainServer;
		ftpTree.refresh();
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
				for (const hostUrl in this.fs.files)
				{
					if (using.has(hostUrl)) continue;
					delete this.fs.files[hostUrl];
				}

				var extra:any = {};
				if (this.targetServer.config !== this.config)
				{
					const targetServerUrl = this.targetServer.config.index;
					if (targetServerUrl) extra.$targetServer = targetServerUrl;
				}
				this.fs.save(this.cacheFile, extra);
			}
			this._clearServer();
			ftpTree.refresh();
		}
		catch(err)
		{
			console.error(err);
		}
	}

	public async selectTarget():Promise<void>
	{
		const server = await this.selectServer();
		if (!server) return;
		this.targetServer = server;
	}

	public async selectServer():Promise<FtpCacher|undefined>
	{
		var selected:FtpCacher|undefined = undefined;
		const pick = new QuickPick;
		for (const server of this.servers.values())
		{
			const config = server.config;
			var name = config.name || config.host;
			if (server === this.targetServer) name += ' *';
			pick.item(name, ()=>{ selected = this.servers.get(config); });
		}
		if (pick.items.length === 1)
		{
			pick.items[0].onselect();
		}
		else
		{
			await pick.open();
		}
		return selected;
	}

	public reconnect(task:Task):Promise<void>
	{
		this.targetServer.terminate();
		return this.targetServer.init(task);
	}

	public async uploadAll(task:Task, path:File): Promise<FtpCacher|undefined>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return undefined;
		await selected.uploadAll(task, path);
		return selected;
	}

	public async downloadAll(task:Task, path:File): Promise<FtpCacher|undefined>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return undefined;
		await selected.downloadAll(task, path);
		return selected;
	}

	public async cleanAll(task:Task): Promise<FtpCacher|undefined>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return undefined;
		await selected.cleanAll(task);
		return selected;
	}
	
	public async list(task:Task, path:File):Promise<void>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return;
		await selected.list(task, path);
	}

	public async runTaskJson(task:Task, taskjson:File):Promise<void>
	{
		const selected = await this.selectServer();
		if (selected === undefined) return;
		const tasks = await taskjson.json();
		await selected.runTaskJsonWithConfirm(task, tasks, taskjson.basename(), taskjson.parent(), false);
	}
}
