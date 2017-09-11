import * as path from 'path';

import * as log from './util/log';
import glob from './util/pglob';
import * as fs from './util/fs';
import * as work from './util/work';
import * as closure from './util/closure';

import * as cfg from './config';
import * as vsutil from './vsutil';

export async function all(task:work.Task):Promise<void>
{
	try
	{
		vsutil.clearLog();
		vsutil.showLog();
		const files = await task.with(glob(fs.workspace+"/**/make.json"));
		for (const file of files)
		{
			await closure.build(task, fs.worklize(file), cfg.config.closure);
		}
		log.message('FINISH ALL');
	}
	catch(err)
	{
		log.message(err);
	}
}

export function makeJson(makejson:string, input?:string):Promise<void>
{
	if (input) input = path.relative(path.dirname(makejson), input).replace(/\\/g, '/');
	else input = "./script.js";
	const output = (input.endsWith('.js') ? input.substring(0, input.length-3) : input) +'.min.js';
	const makejsonDefault = 
	{
		name: "jsproject",
		src: input, 
		output: output,
		includeReference: true,
		closure: {}
	};

	makejson = fs.worklize(makejson);
	return fs.initJson(makejson, makejsonDefault)
		.then(() => vsutil.open(makejson)).then(()=>{});
}

export function make(task:work.Task, makejs:string):Promise<void>
{
	vsutil.clearLog();
	vsutil.showLog();
	return closure.build(task, makejs, cfg.config.closure);
}
