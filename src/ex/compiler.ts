
import * as vscode from 'vscode';
const workspace = vscode.workspace;
const window = vscode.window;

import * as work from '../util/work';
import * as fs from '../util/fs';
import * as externgen from '../util/externgen';
import * as cfgex from './config';
import * as cfg from '../config';
import * as closure from '../closure';
import * as vsutil from '../vsutil';

const config = cfg.config;

function repathToMakeJson(path:string):string
{
    return path.substr(0, path.lastIndexOf('/')+1) + "make.json";
}

async function generateConfirm(makejson:string, input:string, err:Error):Promise<void>
{
	const select = await vsutil.errorConfirm(err, 'Generate make.json');
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
		const selected = await vsutil.fileOrEditorFile(file);
		await closure.makeJson(repathToMakeJson(selected), selected);
	},
	async 'ftpkr.closureCompile' (file:vscode.Uri){
		await cfgex.loadTest();
		await workspace.saveAll();
		work.compile.throwIfBusy();
		work.compile.task('ftpkr.closureCompile', async task => {
			const selected = await vsutil.fileOrEditorFile(file).catch(()=>'');
			var makejson:string = repathToMakeJson(selected);
			try
			{
				if (!await fs.exists(makejson))
				{
					const latestPath = vsutil.context.workspaceState.get('latestCompilePath', '');
					if (!latestPath)
					{
						return generateConfirm(makejson, selected, Error('make.json is not found'));
					}
					if (!await fs.exists(latestPath))
					{
						vsutil.context.workspaceState.update('latestCompilePath', '');
						return generateConfirm(makejson, selected, Error('make.json is not found'));
					}
					makejson = latestPath;
				}
				await closure.make(task, makejson);
				vsutil.context.workspaceState.update('latestCompilePath', makejson);
			}
			catch(err)
			{
				vsutil.error(err);
			}
		});
	},
	async 'ftpkr.closureCompileAll'(){
		await cfgex.loadTest();
		await workspace.saveAll();
		work.compile.throwIfBusy();
		work.compile.task('ftpkr.closureCompileAll', task => {
			vsutil.clearLog();
			vsutil.showLog();
			return closure.all(task);
		});
	},
	async 'ftpkr.generateExtern'(file:vscode.Uri){
		await cfgex.loadTest();
		work.compile.throwIfBusy();
		work.compile.task('ftpkr.generateExtern', async (task) => {
			const selected = await vsutil.fileOrEditorFile(file);
			vsutil.showLog();
			return externgen.gen(task, selected);
		});
	}
};
