
export class Reader
{
	public i:number = 0;
	public data:string = "";

	get eof():boolean
	{
		return this.i >= this.data.length;
	}

	public startsWith(str:string):boolean
	{
		if (this.data.substr(this.i, str.length) !== str)
			return false;
		this.i += str.length;
		return true;
	}

	public startsWithList(strs:string[]):string
	{
		for(var i=0;i<strs.length;i++)
		{
			if (this.startsWith(strs[i]))
				return strs[i];
		}
		return "";
	}

	public peek():string
	{
		return this.data.charAt(this.i);
	}

	public skipSpace():void
	{
		for(;;) switch (this.peek())
		{
		case " ": case "\r": case "\n": case "\t": this.i++; break;
		default: return;
		}
	}

	public readTo(chr:RegExp|string):string
	{
		if (chr instanceof RegExp)
		{
			var nidx = this.data.substr(this.i).search(chr);
			if (nidx === -1)
				return this.readLeft();
			var out = this.data.substr(this.i, nidx);
			this.i = this.i + nidx + RegExp.lastMatch.length;
			return out;
		}
		var nidx = this.data.indexOf(chr, this.i);
		if (nidx === -1)
			return this.readLeft();
		var out = this.data.substring(this.i, nidx);
		this.i = nidx + chr.length;
		return out;
	}

	public space():boolean
	{
		switch (this.peek())
		{
		case " ": case "\r": case "\n": case "\t":
			this.i++;
			this.skipSpace();
			return true;
		default:
			return false;
		}
	}

	public readLeft():string
	{
		var out = this.data.substr(this.i);
		this.i = this.data.length;
		return out;
	}
}

export class Tag
{
	name:string = "";
	props:{[key:string]:string} = {};
	
	constructor(line:Reader, public lineNumber:number)
	{
		if (lineNumber)
			this.lineNumber = lineNumber;

		const tagname = line.readTo(/[ \t]/);
		if (line.eof)
		{
			this.name = tagname;
			return;
		}

		this.name = tagname;
		for(;;)
		{
			line.skipSpace();
			var prop = line.readTo("=");
			if (line.eof) break;
			line.skipSpace();

			var start = line.startsWithList(["'", '"']);
			var value = line.readTo(start);
			this.props[prop] = value;
		}
	}
}

export const WHITE_SPACE = /[ \t\r\n]/g;
export const LINE = /\r?\n/g;
