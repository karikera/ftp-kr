
import { TreeDataProvider, TextDocumentContentProvider, TreeItem, TreeItemCollapsibleState, Uri, CancellationToken, ProviderResult } from "vscode";

import { VFSState, VFSDirectory, FileSystem } from "./util/filesystem";
import { ServerConfig } from "./util/fileinfo";
import { File } from "./util/file";

import { Workspace } from "./vsutil/ws";
import { Scheduler, PRIORITY_NORMAL } from "./vsutil/work";
import { processError } from "./vsutil/error";
import { Logger } from "./vsutil/log";

import { FtpCacher } from "./ftpsync";

class FtpServerFolder
{
	private readonly logger:Logger;
	private readonly scheduler:Scheduler;
	private readonly config:ServerConfig;

	constructor(private readonly workspace:Workspace, private readonly ftpcacher:FtpCacher)
	{
		this.logger = this.workspace.query(Logger);
		this.scheduler = this.workspace.query(Scheduler);
		this.config = this.ftpcacher.config;
	}

	get name():string
	{
		return this.config.name || '';
	}

	isDirectory():boolean
	{
		return true;
	}

	dispose():void
	{
	}
}

export class FtpTree implements TreeDataProvider<VFSState | FtpServerFolder>, TextDocumentContentProvider
{
	private readonly map:WeakMap<FileSystem, FtpServerFolder> = new WeakMap;

	constructor()
	{
	}

	public getTreeItem(element: VFSState | FtpServerFolder): TreeItem
	{
		if (element instanceof FtpServerFolder)
		{
			return {
				label: element.name,
				collapsibleState: TreeItemCollapsibleState.Collapsed,
				command: {
					command: 'ftpkr.downloadAll',
					title: 'Download All'
				}
			};
		}
		else
		{
			if (element.type)
			return {
				label: element.name,
				collapsibleState: TreeItemCollapsibleState.Collapsed,
				command: {
					command: 'ftpkr.download',
					title: 'Download This'
				}
			};
			return {
				label: element.name,
				collapsibleState: TreeItemCollapsibleState.None,
				command: {
					command: 'ftpkr.view',
					title: 'View This'
				}
			};
		}
	}

	public async getChildren(element?: VFSState | FtpServerFolder): Promise<(VFSState | FtpServerFolder)[]>
	{
		try
		{
			if (element instanceof VFSState)
			{
				// var path:string = element ? element.getPath() : (this.config.remotePath || '.');
				
				// const dir = await this.scheduler.taskWithTimeout('ftpkr.list', PRIORITY_NORMAL, 1000, 
				// 	task => this.ftpcacher.ftpList(task, path));
		
				// const files:VFSState[] = [];
				// for (const filename in dir.files)
				// {
				// 	switch (filename)
				// 	{
				// 	case '': case '.': case '..': continue;
				// 	}
				// 	const file = dir.files[filename];
				// 	if (!file) continue;
				// 	files.push(file);
				// }
				// files.sort((a,b)=>{
				// 	return -a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
				// });
				// return files;
			}
			else
			{
			}
			return [];
		}
		catch (err)
		{
			// processError(this.logger, err);
			return [];
		}
	}

	public async provideTextDocumentContent(uri: Uri, token: CancellationToken): Promise<string | null>
	{
		// try
		// {
		// 	const file:File = File.parse(uri.fsPath);
		// 	const ftppath = this.ftpcacher.ftppath(file);
			
		// 	return await this.scheduler.taskWithTimeout('ftpkr.view', PRIORITY_NORMAL, 3000, 
		// 		task=>this.ftpcacher.ftpView(task, ftppath));
		// }
		// catch(err)
		// {
		// 	processError(this.logger, err);
		// 	return '<Error>\n'+err ? (err.stack || err.message || err) : '';
		// }
		return null;
	}

}