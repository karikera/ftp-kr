
import { window, ExtensionContext } from 'vscode';

import { Command } from './vsutil/cmd';
import { Workspace } from './vsutil/ws';

import { FtpTree } from './ftptree';
import { WorkspaceWatcher } from './watcher';
import { Config } from './config';
import { FtpDownloader } from './ftpdown';

import { commands as cfgcmd } from './cmd/config';
import { commands as ftpcmd } from './cmd/ftpsync';
import { defaultLogger } from './vsutil/log';

Workspace.onNew(workspace=>{
	workspace.query(WorkspaceWatcher);
	workspace.query(Config);
	workspace.query(FtpDownloader);
});

export function activate(context:ExtensionContext) {
	console.log('[extension: ftp-kr] activate');

	Command.register(context, cfgcmd, ftpcmd);
	
	Workspace.loadAll();

	// window.registerTreeDataProvider('ftpExplorer', new FtpTree());
}
export function deactivate() {
    try
    {
		Workspace.unloadAll();
        console.log('[extension: ftp-kr] deactivate');
    }
    catch(err)
    {
        defaultLogger.error(err);
    }
}
