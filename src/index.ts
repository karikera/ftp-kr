import * as vscode from 'vscode';
const workspace = vscode.workspace;

import * as log from './vsutil/log';
import * as ws from './vsutil/ws';
import * as work from './vsutil/work';
import * as vsutil from './vsutil/vsutil';
import * as cmd from './vsutil/cmd';

import * as cfg from './config';
import * as watcher from './watcher';

import {commands as cfgcmd} from './cmd/config';
import {commands as ftpcmd} from './cmd/ftpsync';

ws.onNewWorkspace(workspace=>{
	workspace.query(watcher.WorkspaceWatcher);
	workspace.query(cfg.Config);
});

export function activate(context:vscode.ExtensionContext) {
	console.log('[extension: ftp-kr] activate');

	cmd.registerCommands(context, cfgcmd, ftpcmd);
	
	ws.Workspace.loadAll();
}
export function deactivate() {
    try
    {
		ws.Workspace.unloadAll();
        console.log('[extension: ftp-kr] deactivate');
    }
    catch(err)
    {
        log.defaultLogger.error(err);
    }
}
