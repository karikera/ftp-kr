import * as vscode from 'vscode';
const workspace = vscode.workspace;

import * as log from './util/log';
import * as fs from './util/fs';
import * as work from './util/work';
import * as vsutil from './util/vsutil';
import * as command from './util/command';

const extensions = [
	require('./ex/config'), 
	require('./ex/ftpsync'), 
	require('./ex/compiler')
];

export function activate(context:vscode.ExtensionContext) {
	console.log('[extension: ftp-kr] activate');
	vsutil.setContext(context);

    for(const ex of extensions) ex.load();

	for(const name in command.commands)
	{
		const disposable = vscode.commands.registerCommand(name, (...args) => command.runCommand(name, ...args));
		context.subscriptions.push(disposable);
	}
}
export function deactivate() {
    try
    {
        for(var i= extensions.length - 1; i >= 0 ; i--)
            extensions[i].unload();
        console.log('[extension: ftp-kr] deactivate');
    }
    catch(err)
    {
        log.defaultLogger.error(err);
    }
}
