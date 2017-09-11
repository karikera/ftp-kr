import * as vscode from 'vscode';
const workspace = vscode.workspace;

import * as log from './util/log';
import * as fs from './util/fs';
import * as work from './util/work';
import * as vsutil from './vsutil';

work.onError(vsutil.error);
log.set(vsutil.print);

const extensions = [
	require('./ex/config'), 
	require('./ex/ftpsync'), 
	require('./ex/compiler')
];

export function activate(context:vscode.ExtensionContext) {
    console.log('[extension: ftp-kr] activate');
	fs.setWorkspace(workspace.rootPath.replace(/\\/g, "/"));
	vsutil.setContext(context);

    for(const ex of extensions) ex.load();

    for(const ex of extensions) 
    {
        for(const p in ex.commands)
        {
            let command = ex.commands[p];
            const disposable = vscode.commands.registerCommand(p, async(...arg) => {
				try
				{
					await command(...arg);
				}
				catch(err)
				{
					switch (err)
					{
					case work.CANCELLED:
						log.verbose(`[Command:${p}]: cancelled`);
						break;
					case 'PASSWORD_CANCEL':
						log.verbose(`[Command:${p}]: cancelled by password input`);
						break;
					default:
						vsutil.error(err);
						break;
					}
				}
			});
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
        vsutil.error(err);
    }
}
