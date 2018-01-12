
import * as vscode from 'vscode';
const workspace = vscode.workspace;
const window = vscode.window;

import * as work from '../util/work';
import * as fs from '../util/fs';
import * as log from '../util/log';
import * as externgen from '../util/externgen';
import * as vsutil from '../util/vsutil';
import * as cmd from '../util/cmd';
import * as cfgex from './config';
import * as cfg from '../config';
import * as closure from '../closure';


async function generateConfirm(logger:log.Logger, makejson:fs.Path, input:string, err:Error):Promise<void>
{
	const select = await logger.errorConfirm(err, 'Generate make.json');
	if (!select) return;
	await closure.makeJson(makejson, input);
}

export function load()
{
}

export function unload()
{
}

export const commands = {};

cmd.commands['ftpkr.makejson'] = async(args:cmd.Args)=>{
	if (!args.file) throw Error('No file selected');
	await closure.makeJson(args.file.sibling('make.json'), args.file.fsPath);
};
	
cmd.commands['ftpkr.closureCompile'] = async(args:cmd.Args)=>{
	if (!args.workspace) args.workspace = fs.Workspace.first();
	const config = args.workspace.item(cfg.WorkspaceConfig);
	await cfgex.loadTest();
	await workspace.saveAll();
	work.compile.taskWithTimeout('ftpkr.closureCompile', 1000, async(task) => {
		const selected = await vsutil.fileOrEditorFile(file).catch(()=>fs.Workspace.first());
		var makejson = selected.sibling('make.json');
		try
		{
			if (!await makejson.exists())
			{
				const latestPath = vsutil.context.workspaceState.get('latestCompilePath', '');
				if (!latestPath)
				{
					return generateConfirm(makejson, selected.fsPath, Error('make.json is not found'));
				}
				if (!await makejson.exists())
				{
					vsutil.context.workspaceState.update('latestCompilePath', '');
					return generateConfirm(makejson, selected.fsPath, Error('make.json is not found'));
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
};

	async 'ftpkr.closureCompileAll'(){
		await cfgex.loadTest();
		await workspace.saveAll();
		work.compile.taskWithTimeout('ftpkr.closureCompileAll', 1000, task => {
			vsutil.clearLog();
			vsutil.showLog();
			return closure.all(task);
		});
	},
	async 'ftpkr.generateExtern'(file:vscode.Uri){
		await cfgex.loadTest();
		work.compile.taskWithTimeout('ftpkr.generateExtern', 1000, async (task) => {
			const selected = await vsutil.fileOrEditorFile(file);
			vsutil.showLog();
			return externgen.gen(task, selected);
		});
	}
};
