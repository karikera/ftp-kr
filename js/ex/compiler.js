
var vscode = require('vscode');
var workspace = vscode.workspace;
var window = vscode.window;

var fs = require('../fs');
var work = require('../work');
var closure = require('../closure');
var util = require('../util');

function getSelectedPath()
{
    var doc = window.activeTextEditor.document;
    var localpath = doc.fileName.replace(/\\/g, '/');
    return localpath.substr(0, localpath.lastIndexOf('/')+1);
}


var MAKEJSON_DEFAULT = 
{
    "name": "jsproject",
    "src": "script.js", 
    "output": "./script.min.js",
    "includeReference": true,
    "closure": {}
};

module.exports = {
    load : function () {

    },
    unload: function() {

    },
    commands: {
        'ftpkr.makejson':function (){
            var makejson = fs.worklize(getSelectedPath() + "make.json");
            fs.exists(makejson)
            .then((res) => {if(!res) return fs.initJson(makejson, MAKEJSON_DEFAULT); })
            .then(() => util.open(makejson))
            .catch(util.error);
        },
        'ftpkr.closureCompile':function (){
            work.compile.add(
                () => workspace.saveAll()
                .then(function(){
                    if (!window.activeTextEditor) return;
                    return closure.make(getSelectedPath() + "make.json");
                })
            )
            .catch(util.error);
        },
        'ftpkr.closureCompileAll': function(){
            work.compile.add(
                () => workspace.saveAll()
                .then(() => closure.all())
            )
            .catch(util.error);
        }
    }
};