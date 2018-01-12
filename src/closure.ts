
import * as fs from './util/fs';
import * as work from './util/work';
import * as closure from './util/closure';
import * as vsutil from './util/vsutil';

import * as cfg from './config';

export async function all(task:work.Task):Promise<void>
{
	try
	{
		task.logger.clear();
		task.logger.show();
		
		for(const ws of fs.Workspace.all())
		{
			const files = await task.with(ws.child('**/make.json').glob());
			const config = cfg.get(ws);
			for (const file of files)
			{
				await closure.build(task, file, config.closure);
			}
		}
		task.logger.message('FINISH ALL');
	}
	catch(err)
	{
		task.logger.message(err);
	}
}

export function makeJson(makejson:fs.Path, input?:string):Promise<void>
{
	if (input && input.endsWith('.js'))
	{
		input = makejson.child(input).fsPath;
	}
	else
	{
		input = "./script.js";
	}
	const output = input +'.min.js';
	const makejsonDefault = 
	{
		name: "jsproject",
		src: input, 
		output: output,
		includeReference: true,
		closure: {}
	};

	return makejson.initJson(makejsonDefault).then(() => vsutil.open(makejson)).then(()=>{});
}

export function make(task:work.Task, makejs:fs.Path):Promise<void>
{
	task.logger.clear();
	task.logger.show();
	const config = cfg.get(makejs.workspace());
	return closure.build(task, makejs, config.closure);
}
