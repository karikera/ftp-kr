
import * as cp from 'child_process';
import * as path from 'path';
import * as util from './util';

export function gen(jsfile:string):Promise<void>
{
	return new Promise<void>((res, rej)=>{
		util.showLog();
		jsfile = path.resolve(jsfile);
		const jsfiledir = path.dirname(jsfile);
		const proc = cp.fork(`${__dirname}/externgen_sandbox.js`, [jsfile], {cwd:jsfiledir});
		var end = false;
		proc.on('message', data=>{
			if (typeof data  === 'string')
			{
				util.log(data);
				return;
			}
			end = true;
			if (data.error)
			{
				rej(Error(data.error));
			}
			else
			{
				util.log(data.output);
				res();
			}
		});
		proc.on('close', exitCode=>{
			if (!end) rej(Error('exit code:'+exitCode));
		});
	});
}
