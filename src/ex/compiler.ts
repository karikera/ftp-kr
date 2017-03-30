
import * as vscode from 'vscode';
const workspace = vscode.workspace;
const window = vscode.window;

import * as cfg from './config';
import * as work from '../work';
import * as closure from '../closure';
import * as util from '../util';
import * as externgen from '../externgen';

var latestCompilePath:string = '';

function getSelectedFilePath():string
{
	return window.activeTextEditor.document.fileName.replace(/\\/g, '/');
}

function getSelectedMakeJson():string
{
	const filename = getSelectedFilePath();
    return filename.substr(0, filename.lastIndexOf('/')+1) + "make.json";
}

function generateConfirm(makejson:string, input:string, err:Error):Thenable<void>
{
	return util.errorConfirm(err, 'Generate make.json')
	.then((select)=>{
		if (!select) return;
		return closure.makeJson(makejson, input);
	});
}

export function load()
{
}

export function unload()
{
}

export var commands = {
	'ftpkr.makejson' (){
		if (!window.activeTextEditor) return;
		return closure.makeJson(getSelectedMakeJson(), getSelectedFilePath()).catch(util.error);
	},
	'ftpkr.closureCompile' (){
		return cfg.loadTest()
		.then(() => workspace.saveAll())
		.then(() => work.compile.add(() => {
				if (!window.activeTextEditor) return;
				const input = getSelectedFilePath();
				const makejson = getSelectedMakeJson();
				return closure.make(makejson)
				.then(() => { latestCompilePath = makejson; })
				.catch((err)=>{
					if (err.code !== 'ENOENT')
					{
						util.log(err);
						return;
					}
					if (latestCompilePath)
					{
						return closure.make(latestCompilePath)
						.catch((err)=>{
							if (err.code !== 'ENOENT')
							{
								util.log(err);
								return;
							}
							latestCompilePath = '';
							return generateConfirm(makejson, input, err);
						});
					}
					else
					{
						return generateConfirm(makejson, input, err);
					}
				})
			})
		)
		.catch(util.error);
	},
	'ftpkr.closureCompileAll'(){
		return cfg.loadTest()
		.then(() => workspace.saveAll())
		.then(() => work.compile.add(() => closure.all()).catch(util.error))
		.catch(util.error);
	},
	'ftpkr.generateExtern'(){
		return cfg.loadTest()
		.then(() => workspace.saveAll())
		.then(() => work.compile.add(() => {
				if (!window.activeTextEditor) return;
				return externgen.gen(getSelectedFilePath())
				.catch((err)=>{
					util.error(err);
				});
			})
		)
		.catch(util.error);
	}
};
