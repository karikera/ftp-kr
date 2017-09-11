
import * as fs from './fs';

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
				try
				{
					const stat = await fs.stat(target);
					if(!mtime) mtime = +stat.mtime;
				}
				catch(err)
				{
					mtime = -1;
				}
				const stat = await fs.stat(child);
				if (mtime <= +stat.mtime) modified = true;
			}
		}

		if (modified) return options.callback();
		return modified;
	}
}

export default MakeFile;
