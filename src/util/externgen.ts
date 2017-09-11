
import * as cp from 'child_process';
import * as path from 'path';
import * as log from './log';
import * as work from './work';

export function gen(task:work.Task, jsfile:string):Promise<void>
{
	return new Promise<void>((res, rej)=>{
		jsfile = path.resolve(jsfile);
		const jsfiledir = path.dirname(jsfile);
		const proc = cp.fork(`${__dirname}/externgen_sandbox.js`, [jsfile], {cwd:jsfiledir});
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
