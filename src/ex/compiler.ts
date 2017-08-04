
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

async function generateConfirm(makejson:string, input:string, err:Error):Promise<void>
{
	const select = await util.errorConfirm(err, 'Generate make.json');
	if (!select) return;
	await closure.makeJson(makejson, input);
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
		return closure.makeJson(getSelectedMakeJson(), getSelectedFilePath());
	},
	async 'ftpkr.closureCompile' (){
		await cfg.loadTest();
		await workspace.saveAll();
		await work.compile.work('ftpkr.closureCompile', async () => {
			if (!window.activeTextEditor) return;
			const input = getSelectedFilePath();
			const makejson = getSelectedMakeJson();
			try
			{
				await closure.make(makejson);
				latestCompilePath = makejson;
			}
			catch(err)
			{
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
			}
		});
	},
	async 'ftpkr.closureCompileAll'(){
		await cfg.loadTest();
		await workspace.saveAll();
		await work.compile.work('ftpkr.closureCompileAll', () => closure.all());
	},
	async 'ftpkr.generateExtern'(){
		await cfg.loadTest();
		await workspace.saveAll();
		await work.compile.work('ftpkr.generateExtern', () => {
			if (!window.activeTextEditor) return;
			return externgen.gen(getSelectedFilePath());
		});
	}
};
