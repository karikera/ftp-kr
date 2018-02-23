
import { TreeDataProvider, TextDocumentContentProvider, TreeItem, TreeItemCollapsibleState, Uri, CancellationToken, ProviderResult, EventEmitter, Event } from "vscode";
import { File } from 'krfile';

import { VFSState, VFSDirectory, VirtualFileSystem, VFSServer, VFSSymLink } from "./util/filesystem";

import { Workspace } from "./vsutil/ws";
import { Scheduler, PRIORITY_NORMAL } from "./vsutil/work";
import { processError } from "./vsutil/error";
import { Logger, defaultLogger } from "./vsutil/log";
import { FtpCacher } from "./ftpcacher";
import { vsutil } from "./vsutil/vsutil";
import { FtpTreeItem, FtpTreeServer } from "./vsutil/ftptreeitem";

export class FtpTree implements TreeDataProvider<FtpTreeItem>, TextDocumentContentProvider
{
	private _onDidChangeTreeData: EventEmitter<FtpTreeItem> = new EventEmitter<FtpTreeItem>();
	private _onDidChange: EventEmitter<Uri> = new EventEmitter<Uri>();
	readonly onDidChangeTreeData: Event<FtpTreeItem> = this._onDidChangeTreeData.event;
	readonly onDidChange: Event<Uri> = this._onDidChange.event;
	
	private readonly map:Map<FtpCacher, FtpTreeServer> = new Map;

	constructor()
	{
	}

	public refreshContent(target:VFSState):void
	{
		this._onDidChange.fire(Uri.parse(target.getUrl()));
	}

	public refreshTree(target?:VFSState):void
	{
		if (!target)
		{
			FtpTreeItem.clear();
			this._onDidChangeTreeData.fire();
			for (const server of this.map.values())
			{
				server.children = undefined;
				server.ftpFile = undefined;
			}
		}
		else
		{
			for (const item of FtpTreeItem.get(target))
			{
				FtpTreeItem.delete(item);
				this._onDidChangeTreeData.fire(item);
				if (item.server === item)
				{
					item.children = undefined;
					item.ftpFile = undefined;
				}
			}
		}
	}

	public getServerFromUri(uri:Uri):FtpTreeServer
	{
		for (const server of this.map.values())
		{
			if (uri.scheme + '://' + uri.authority === server.config.hostUrl)
			{
				if (uri.path === server.ftp.remotePath || uri.path.startsWith(server.ftp.remotePath + '/'))
				{
					return server;
				}
			}
		}
		throw Error('Server not found: '+uri);
	}

	public addServer(server:FtpCacher):void
	{
		const folder = new FtpTreeServer(server.workspace, server);
		this.map.set(server, folder);
	}

	public removeServer(server:FtpCacher):void
	{
		const folder = this.map.get(server);
		if (folder)
		{
			this.map.delete(server);
			folder.dispose();
		}
	}

	public getTreeItem(element: FtpTreeItem): TreeItem
	{
		return element;
	}

	public async getChildren(element?: FtpTreeItem): Promise<FtpTreeItem[]>
	{
		var logger = defaultLogger;
		try
		{
			if (!element)
			{
				return [...this.map.values()];
			}
			else
			{
				logger = element.server.logger;
				return await element.getChildren();
			}
		}
		catch (err)
		{
			processError(logger, err);
			return [];
		}
	}

	public async provideTextDocumentContent(uri: Uri, token: CancellationToken): Promise<string | null>
	{
		var logger = defaultLogger;
		try
		{
			const server = this.getServerFromUri(uri);
			logger = server.logger;

			const ftppath = uri.path;
			const viewed = await server.downloadAsText(ftppath);
			if (viewed.file) viewed.file.contentCached = true;
			return viewed.content;
		}
		catch(err)
		{
			processError(logger, err);
			return '<Error>\n'+err ? (err.stack || err.message || err) : '';
		}
	}

}

export const ftpTree = new FtpTree;
