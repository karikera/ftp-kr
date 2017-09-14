
import * as fs from 'fs';
import * as util from './util';

class MakeFileItem
{
	constructor(public children:string[], public callback:()=>Promise<boolean>)
	{
	}
}

class MakeFile
{
	map = new Map<string, MakeFileItem>();

	on(master:string, children:string[], callback:()=>Promise<boolean>):void
	{
		this.map.set(master, new MakeFileItem(children, callback));
	}

	async make(target:string):Promise<boolean>
	{
		const that = this;
		var mtime = 0;
		const options = this.map.get(target);
		if (!options) return false;

		const children = options.children;
		if (children.length === 0)
			return options.callback();

		var modified = false;
		for(const child of children)
		{
			const mod = await that.make(child);
			modified = modified || mod;
			if (!modified)
			{
				if(!mtime)
				{
					try
					{
						const stat = await util.callbackToPromise<fs.Stats>(cb=>fs.stat(target, cb));
						mtime = +stat.mtime;
					}
					catch(err)
					{
						mtime = -1;
					}
				}
				const stat = await util.callbackToPromise<fs.Stats>(cb=>fs.stat(target, cb));
				if (mtime <= +stat.mtime) modified = true;
			}
		}

		if (modified) return options.callback();
		return modified;
	}
}

export default MakeFile;
