
import { TreeItemCollapsibleState, TreeItem, Uri } from "vscode";

import { VFSSymLink, VFSState } from "../util/filesystem";
import { ServerConfig } from "../util/serverinfo";

import { PRIORITY_NORMAL, Scheduler } from "./work";
import { Workspace } from "./ws";
import { FtpCacher, ViewedFile } from "../ftpcacher";
import { Logger } from "./log";

const ftpTreeItemFromFile = new Map<VFSState, FtpTreeItem[]>();

export class FtpTreeItem extends TreeItem
{
	public server:FtpTreeServer;
	public children?:FtpTreeItem[];

	static clear()
	{
		for (const items of ftpTreeItemFromFile.values())
		{
			for (const item of items)
			{
				item.children = undefined;
			}
		}
		ftpTreeItemFromFile.clear();
	}

	static get(ftpFile:VFSState):FtpTreeItem[]
	{
		const array = ftpTreeItemFromFile.get(ftpFile);
		if (array) return array;
		else return [];
	}

	static add(ftpFile:VFSState, item:FtpTreeItem):void
	{
		var array = ftpTreeItemFromFile.get(ftpFile);
		if (!array) ftpTreeItemFromFile.set(ftpFile, array = []);
		array.push(item);
	}

	static delete(item:FtpTreeItem):void
	{
		if (!item.ftpFile) return;
		const array = ftpTreeItemFromFile.get(item.ftpFile);
		if(!array) return;

		for (var i=0;i<array.length;i++)
		{
			if (array[i] !== item) continue;
			array.splice(i, 1);

			if (array.length === 0)
			{
				ftpTreeItemFromFile.delete(item.ftpFile);
			}
			if (item.children)
			{
				for (const child of item.children)
				{
					FtpTreeItem.delete(child);
				}
				item.children = undefined;
			}
			break;
		}
	}

	static create(ftpFile:VFSState, server:FtpTreeServer):FtpTreeItem
	{
		for (const item of FtpTreeItem.get(ftpFile))
		{
			if (item.server === server)
			{
				return item;
			}
		}
		return new FtpTreeItem(ftpFile.name, ftpFile, server);
	}

	constructor(label:string, public ftpFile:VFSState|undefined, server?:FtpTreeServer)
	{
		super(label, (!ftpFile ||  ftpFile.type === 'd') ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None);
		this.server = server || <any>this;

		if (ftpFile)
		{
			FtpTreeItem.add(ftpFile, this);
			if (ftpFile.type === '-')
			{
				this.command = {
					command: 'ftpkr.view',
					title: 'View This',
					arguments: [Uri.parse(ftpFile.getUrl())]
				};
			}
		}
	}

	compare(other:FtpTreeItem):number
	{
		return (other.collapsibleState||0) - (this.collapsibleState||0) || this.label.localeCompare(other.label);
	}

	async getChildren():Promise<FtpTreeItem[]>
	{
		if (this.children) return this.children;
		const items = await this.server.getChildrenFrom(this);
		if (this.ftpFile) this.ftpFile.treeCached = true;
		this.children = items;
		return items;
	}
}

export class FtpTreeServer extends FtpTreeItem
{
	public readonly logger:Logger;
	public readonly config:ServerConfig;
	private readonly scheduler:Scheduler;

	constructor(public readonly workspace:Workspace, public readonly ftp:FtpCacher)
	{
		super(ftp.getName(), undefined);

		this.logger = this.workspace.query(Logger);
		this.scheduler = this.workspace.query(Scheduler);
		this.config = this.ftp.config;
	}

	public dispose():void
	{
		FtpTreeItem.delete(this);
	}

	public async getChildrenFrom(file:FtpTreeItem):Promise<FtpTreeItem[]>
	{
		if (!file.ftpFile)
		{
			await this.ftp.init();
			file.ftpFile = this.ftp.home;
			FtpTreeItem.add(file.ftpFile, file);
		}
		const path:string = file.ftpFile.getPath();
		
		const files:FtpTreeItem[] = [];
		const dir = await this.ftp.ftpList(path);

		for (var childfile of dir.children())
		{				
			while (childfile instanceof VFSSymLink)
			{
				const putfile:VFSSymLink = childfile;
				const nchildfile = await this.ftp.ftpTargetStat(putfile);
				if (!nchildfile) return [];
				childfile = nchildfile;
			}

			files.push(FtpTreeItem.create(childfile, this));
		}
		files.sort((a,b)=>a.compare(b));
		return files;
	}

	public async getChildren():Promise<FtpTreeItem[]>
	{
		await this.ftp.init();
		return await super.getChildren();
	}

	public downloadAsText(ftppath:string):Promise<ViewedFile>
	{
		return this.ftp.downloadAsText(ftppath);
	}
}
