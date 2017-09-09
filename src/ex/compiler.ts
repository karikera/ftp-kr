
import * as vscode from 'vscode';
const workspace = vscode.workspace;
const window = vscode.window;

import * as cfgex from './config';
import * as cfg from '../config';
import * as work from '../work';
import * as closure from '../closure';
import * as util from '../util';
import * as fs from '../fs';
import * as externgen from '../externgen';

const config = cfg.config;

function repathToMakeJson(path:string):string
{
    return path.substr(0, path.lastIndexOf('/')+1) + "make.json";
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

export const commands = {
	async 'ftpkr.makejson' (file:vscode.Uri){
		const selected = await util.fileOrEditorFile(file);
		await closure.makeJson(repathToMakeJson(selected), selected);
	},
	async 'ftpkr.closureCompile' (file:vscode.Uri){
		await cfgex.loadTest();
		await workspace.saveAll();
		work.compile.throwIfBusy();
		work.compile.task('ftpkr.closureCompile', async task => {
			const selected = await util.fileOrEditorFile(file).catch(()=>'');
			var makejson:string = repathToMakeJson(selected);
			try
			{
				if (!await fs.exists(makejson))
				{
					const latestPath = util.context.workspaceState.get('latestCompilePath', '');
					if (!latestPath)
					{
						return generateConfirm(makejson, selected, Error('make.json is not found'));
					}
					if (!await fs.exists(latestPath))
					{
						util.context.workspaceState.update('latestCompilePath', '');
						return generateConfirm(makejson, selected, Error('make.json is not found'));
					}
					makejson = latestPath;
				}
				await closure.make(task, makejson);
				util.context.workspaceState.update('latestCompilePath', makejson);
			}
			catch(err)
			{
				util.error(err);
			}
		});
	},
	async 'ftpkr.closureCompileAll'(){
		await cfgex.loadTest();
		await workspace.saveAll();
		work.compile.throwIfBusy();
		work.compile.task('ftpkr.closureCompileAll', task => closure.all(task));
	},
	async 'ftpkr.generateExtern'(file:vscode.Uri){
		await cfgex.loadTest();
		work.compile.throwIfBusy();
		work.compile.task('ftpkr.generateExtern', async (task) => {
			const selected = await util.fileOrEditorFile(file);
			return externgen.gen(task, selected);
		});
	}
};
