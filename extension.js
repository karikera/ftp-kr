const vscode = require('vscode');
const workspace = vscode.workspace;

const util = require('./js/util');
const fs = require('./js/fs');

const extensions = [
	require('./js/ex/config'), 
	require('./js/ex/ftpsync'), 
	require('./js/ex/compiler')
];

function activate(context) {
    console.log('[extension: ftp-kr] activate');
    fs.workspace = workspace.rootPath.replace(/\\/g, "/");

    for(const ex of extensions) ex.load();

    for(const ex of extensions) 
    {
        for(const p in ex.commands)
        {
            let command = ex.commands[p];
            const disposable = vscode.commands.registerCommand(p,() => command().catch(util.error));
            context.subscriptions.push(disposable);
        }
    }
}
function deactivate() {
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

exports.activate = activate;
exports.deactivate = deactivate;