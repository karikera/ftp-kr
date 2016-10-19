var vscode = require('vscode');
var workspace = vscode.workspace;

// \!\[feature X\]\(images/feature-x.png\)
var util = require('./js/util');
var fs = require('./js/fs');

var extensions = [
    require('./js/ex/config'), 
    require('./js/ex/ftpsync'), 
    require('./js/ex/compiler')
];

function activate(context) {
    console.log('[extension: ftp-kr] activate');
    fs.workspace = workspace.rootPath.replace(/\\/g, "/");

    for(var ex of extensions) ex.load();

    for(var ex of extensions) 
    {
        for(var p in ex.commands)
        {
            let disposable = vscode.commands.registerCommand(p,ex.commands[p]);
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