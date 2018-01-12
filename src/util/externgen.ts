
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from './fs';
import * as log from './log';
import * as work from './work';

export function gen(task:work.Task, jsfile:fs.Path):Promise<void>
{
	return new Promise<void>((res, rej)=>{
		const jsfiledir = jsfile.parent();
		const proc = cp.fork(`${__dirname}/externgen_sandbox.js`, [jsfile.fsPath], {cwd:jsfiledir.fsPath});
		var end = false;
		proc.on('message', data=>{
			if (typeof data  === 'string')
			{
				log.message(data);
				return;
			}
			end = true;
			if (data.error)
			{
				rej(Error(data.error));
			}
			else
			{
				log.message(data.output);
				res();
			}
		});
		const oncancel = task.oncancel(()=>proc.kill());
		proc.on('close', (exitCode, signal)=>{
			if (signal === 'SIGTERM')
			{
				oncancel.dispose();
				rej(work.CANCELLED);
				return;
			}			
			if (!end) rej(Error('exit code:'+exitCode));
		});
	});
}
