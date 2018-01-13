import * as vscode from 'vscode';
const workspace = vscode.workspace;

import * as log from './util/log';
import * as fs from './util/fs';
import * as work from './util/work';
import * as vsutil from './util/vsutil';
import * as cmd from './util/cmd';

const extensions = [
	require('./ex/config'), 
	require('./ex/ftpsync')
];

export function activate(context:vscode.ExtensionContext) {
	console.log('[extension: ftp-kr] activate');
	vsutil.setContext(context);

	for(const name in cmd.commands)
	{
		const disposable = vscode.commands.registerCommand(name, (...args) => cmd.runCommand(name, ...args));
		context.subscriptions.push(disposable);
	}
	fs.Workspace.loadAll();
}
export function deactivate() {
    try
    {
		fs.Workspace.unloadAll();
        console.log('[extension: ftp-kr] deactivate');
    }
    catch(err)
    {
        log.defaultLogger.error(err);
    }
}
