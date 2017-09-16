
import * as fs from 'fs';
import * as util from './util';

class MakeFileItem
{
	constructor(public children:string[], public callback:()=>Promise<State>)
	{
	}
}

export enum State
{
	LATEST,
	COMPLETE,
	ERROR
}

export class MakeFile
{
	map = new Map<string, MakeFileItem>();

	on(master:string, children:string[], callback:()=>Promise<State>):void
	{
		this.map.set(master, new MakeFileItem(children, callback));
	}

	async make(target:string):Promise<State>
	{
		const that = this;
		var mtime = 0;
		const options = this.map.get(target);
		if (!options) return State.LATEST;

		const children = options.children;
		if (children.length === 0) return options.callback();

		var state = State.LATEST;
		for(const child of children)
		{
			const res = await that.make(child);
			if (res > state) state = res;
			if (state !== State.LATEST) continue;
			if(!mtime)
			{
				try
				{
					const stat = await util.callbackToPromise<fs.Stats>(cb=>fs.stat(target, cb));
					mtime = +stat.mtime;
				}
				catch(err)
				{
					state = State.COMPLETE;
					continue;
				}
			}
			
			try
			{
				const stat = await util.callbackToPromise<fs.Stats>(cb=>fs.stat(target, cb));
				if (mtime <= +stat.mtime) state = State.COMPLETE;
			}
			catch (err)
			{
				state = State.COMPLETE;
			}
		}

		if (state !== State.COMPLETE) return state;
		return options.callback();
	}
}

