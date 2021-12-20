
try {
	require('source-map-support/register');
} catch (err) {
}

import { ExtensionContext, window, workspace } from 'vscode';
import { commands as cfgcmd } from './cmd/config';
import { commands as ftpcmd } from './cmd/ftpsync';
import { Config } from './config';
import { FtpDownloader } from './ftpdown';
import { ftpTree } from './ftptree';
import { Command } from './vsutil/cmd';
import { Workspace } from './vsutil/ws';
import { WorkspaceWatcher } from './watcher';



Workspace.onNew(workspace=>{
	workspace.query(WorkspaceWatcher);
	workspace.query(Config);
	workspace.query(FtpDownloader);
});

export function activate(context:ExtensionContext) {
	console.log('[extension: ftp-kr] activate');

	Command.register(context, cfgcmd, ftpcmd);
	
	Workspace.loadAll();

	workspace.registerTextDocumentContentProvider('sftp', ftpTree.getContentProvider('sftp'));
	workspace.registerTextDocumentContentProvider('ftp', ftpTree.getContentProvider('ftp'));
	workspace.registerTextDocumentContentProvider('ftps', ftpTree.getContentProvider('ftps'));
	window.registerTreeDataProvider('ftpkr.explorer', ftpTree);
}
export function deactivate() {
    try
    {
		Workspace.unloadAll();
        console.log('[extension: ftp-kr] deactivate');
    }
    catch(err)
    {
        console.error(err);
    }
}
