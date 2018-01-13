
import * as fs from './fs';
import * as path from 'path';
import {Tag,Reader} from './reader';

export class Includer
{
	included:Set<string> = new Set;
	including:Set<string> = new Set;
	list:fs.Path[] = [];
	errors:Array<[fs.Path, number, string]> = [];
	
	async include(src:fs.Path|fs.Path[]):Promise<void>
	{
		if (src instanceof Array)
		{
			for (var i=0;i<src.length;i++)
			{
				this.include(src[i]);
			}
			return;
		}
		if (this.included.has(src.fsPath))
			return;
		if (this.including.has(src.fsPath))
			throw Error("SELF_INCLUDE");
		this.included.add(src.fsPath);
		this.including.add(src.fsPath);

		try
		{
			var data:string = await src.open();
		}
		catch(e)
		{
			throw Error("FILE_NOT_FOUND");
		}
		const arr:Tag[] = readXml(data);

		var dir = src.parent();
		for (const tag of arr)
		{
			switch (tag.name)
			{
			case "reference":
				var file = dir.child(tag.props.path);
				if (file.ext() === 'd.ts') break;
				try
				{
					this.include(file);
				}
				catch(e)
				{
					switch(e.message)
					{
					case "SELF_INCLUDE":
						this.errors.push([src, tag.lineNumber, e.message]);
						break;
					case "FILE_NOT_FOUND":
						this.errors.push([src, tag.lineNumber, "File not found: "+file.fsPath]);
						break;
					default: throw e;
					}
				}
				break;
			}
		}
		this.list.push(src);
	}

}

export function readXml(data:string):Tag[]
{
	const page = new Reader;
	page.data = data;
	if (data.charCodeAt(0) === 0xfeff) page.i = 1;

	var lineNumber = 0;
	const line = new Reader;
	const out:Tag[] = [];

	for(;;)
	{
		page.skipSpace();
		if (!page.startsWith("///")) break;
		
		lineNumber++;
		line.i = 0;
		var linestr = page.readTo("\n");
		if (!linestr) continue;
	
		line.data = linestr;
		const close = line.data.lastIndexOf("/>");
		if (close === -1) continue;
		line.data = line.data.substr(0, close);

		line.skipSpace();
		if (!line.startsWith("<")) continue;
		out.push(new Tag(line, lineNumber));
	}
	return out;
}

export function normalize(src:string[]):string[]
{
	const sort = new Set<string>();
	for (const s of src)
	{
		sort.add(path.resolve(s));
	}
	return [...sort.values()].sort();
}
