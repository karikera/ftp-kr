
import { TreeDataProvider, TextDocumentContentProvider, TreeItem, TreeItemCollapsibleState, Uri, CancellationToken, ProviderResult, EventEmitter, Event } from "vscode";
import { File } from 'krfile';

import { VFSState, VFSDirectory, VirtualFileSystem, VFSServer, VFSSymLink } from "./util/filesystem";

import { Workspace } from "./vsutil/ws";
import { Scheduler, PRIORITY_NORMAL } from "./vsutil/work";
import { processError } from "./vsutil/error";
import { Logger, defaultLogger } from "./vsutil/log";
import { FtpCacher, ViewedFile } from "./ftpcacher";
import { vsutil } from "./vsutil/vsutil";
import { FtpTreeItem, FtpTreeServer } from "./vsutil/ftptreeitem";

// private readonly viewCache:Map<string, ViewCache> = new Map;

const cacheMap = new Map<string, Promise<ViewedFile>>();

function cache(path:string, cb:()=>Promise<ViewedFile>):Promise<ViewedFile>
{
	var cached = cacheMap.get(path);
	if (cached) return cached;

	setTimeout(()=>{
		cacheMap.delete(path);
	}, 500);

	const newcached = cb();
	cacheMap.set(path, newcached);
	return newcached;
}

export class FtpContentProvider implements TextDocumentContentProvider
{
	readonly _onDidChange: EventEmitter<Uri> = new EventEmitter<Uri>();
	readonly onDidChange: Event<Uri> = this._onDidChange.event;

	constructor(public readonly scheme:string)
	{
	}
	
	public async provideTextDocumentContent(uri: Uri, token: CancellationToken): Promise<string | null>
	{
		var logger = defaultLogger;
		try
		{
			const server = ftpTree.getServerFromUri(uri);
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

export class FtpTree implements TreeDataProvider<FtpTreeItem>
{
	private readonly _onDidChangeTreeData: EventEmitter<FtpTreeItem> = new EventEmitter<FtpTreeItem>();
	readonly onDidChangeTreeData: Event<FtpTreeItem> = this._onDidChangeTreeData.event;
	
	private readonly map = new Map<FtpCacher, FtpTreeServer>();
	private readonly contentProviders = new Map<string, FtpContentProvider>();

	constructor()
	{
	}

	public getContentProvider(scheme:string):FtpContentProvider
	{
		var cp = this.contentProviders.get(scheme);
		if (cp) return cp;
		cp = new FtpContentProvider(scheme);
		this.contentProviders.set(scheme, cp);
		return cp;
	}

	public refreshContent(target:VFSState):void
	{
		defaultLogger.verbose('refreshContent '+target.getUrl());
		const uri = Uri.parse(target.getUrl());
		const cp = this.contentProviders.get(uri.scheme);
		if (!cp) return;
		cp._onDidChange.fire();
	}

	public refreshTree(target?:VFSState):void
	{
		defaultLogger.verbose('refreshTree '+(target ? target.getUrl() : "all"));
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
				if (item.children)
				{
					for (const child of item.children)
					{
						FtpTreeItem.delete(child);
					}
					item.children = undefined;
				}
				if (item.server === item)
				{
					item.ftpFile = undefined;
				}
				this._onDidChangeTreeData.fire(item);
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
}

export const ftpTree = new FtpTree;
