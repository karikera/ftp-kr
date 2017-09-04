import * as vscode from 'vscode';
const workspace = vscode.workspace;

import * as util from './util';
import * as fs from './fs';

const extensions = [
	require('./ex/config'), 
	require('./ex/ftpsync'), 
	require('./ex/compiler')
];

export function activate(context:vscode.ExtensionContext) {
    console.log('[extension: ftp-kr] activate');
	fs.setWorkspace(workspace.rootPath.replace(/\\/g, "/"));
	util.setContext(context);

    for(const ex of extensions) ex.load();

    for(const ex of extensions) 
    {
        for(const p in ex.commands)
        {
            let command = ex.commands[p];
            const disposable = vscode.commands.registerCommand(p,(...arg) => command(...arg).catch(util.error));
			context.subscriptions.push(disposable);
        }
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
        util.error(err);
    }
}
