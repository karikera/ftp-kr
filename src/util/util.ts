
import stripJsonComments = require('strip-json-comments');

export class Deferred<T> implements Promise<T>
{
	public resolve:((v:T)=>void);
	public reject:((v:any)=>void);
	public readonly [Symbol.toStringTag] = "Promise";
	private promise:Promise<T> = new Promise<T>((res, rej)=>{
		this.resolve = res;
		this.reject = rej;
	});
	
	public then<R1,R2>(onfulfilled:(v:T)=>R1|Promise<R1>, onreject?:(v:any)=>R2|Promise<R2>):Promise<R1|R2>
	{
		return this.promise.then(onfulfilled, onreject);
	}

	public catch<R2>(func:(v:any)=>R2|Promise<R2>):Promise<T|R2>
	{
		return this.promise.catch(func);
	}
}

export function isEmptyObject(obj:Object):boolean
{
	for(var p in obj) return false;
	return true;
}

export function addOptions(args:string[], options:Object):void
{
	for (const key in options)
	{
		const value = options[key];
		if (Array.isArray(value))
		{
			for (const val of value)
			{
				args.push("--" + key);
				args.push(val);
			}
			continue;
		}
		if (typeof value === 'boolean' && value === false)
		{
			continue;
		}
		args.push("--" + key);
		if (value !== true)
		{
			args.push(value);
		}
	}
}

export function merge<T>(original:T, overrider?:T, access?:T):T
{
	if (!overrider) return original;

    const conststr:string[] = [];
    const arrlist:string[][] = [];
	var nex:T;

    if(!access)
    {
        nex = original;
    }
    else
    {
		nex = access;
        for(var p in original) access[p] = original[p];
    }

    function convert(value:any):any
    {
        if (typeof value !== "string") return value;
        
        var nvalue = "";
        var i = 0;
        for(;;)
        {
            var j = value.indexOf("%", i);
            if (j === -1) break;
            var tx = value.substring(i, j);
            j++;
            var k = value.indexOf("%", j);
            if (k === -1) break;
            nvalue += tx;
            var varname = value.substring(j, k);
            if (varname in nex)
            {
                var val = nex[varname];
                if (val instanceof Array)
                {
                    if (val.length === 1)
                    {
                        nvalue += val[0];
                    }
                    else
                    {
                        conststr.push(nvalue);
                        nvalue = '';
                        arrlist.push(val);
                    }
                }
                else
                    nvalue += val;
            }
            else nvalue += "%" + varname + "%";
            i = k + 1;
        }

        nvalue += value.substr(i);
        if (arrlist.length !== 0)
        {
            conststr.push(nvalue);
            var from:string[][] = [conststr];
            var to:string[][] = [];
            for(var j=0;j<arrlist.length;j++)
            {
                const list = arrlist[j];
                for(var i=0; i<list.length;i++)
                {
                    for(var k=0;k<from.length;k++)
                    {
                        const cs = from[k];
                        const ncs = cs.slice(1, cs.length);
                        ncs[0] = cs[0] + list[i] + cs[1];
                        to.push(ncs);
                    }
                }
                var t = to;
                to = from;
                from = t;
                to.length = 0;
            }
            return from.map(v=>v[0]);
        }
        return nvalue;
    }

    var out:T = <T>{};

    for(var p in overrider)
    {
        var value = overrider[p];
		if (value instanceof Array)
        {
            const nvalue:any[] = [];
            for(let val of value)
            {
                val = convert(val);
                if (val instanceof Array) nvalue.push(nvalue, ...val);
                else nvalue.push(val);
            }
            out[p] = <any>nvalue;
        }
		else if (value instanceof Object)
		{
			const ori = original[p];
			if (ori instanceof Object)
			{
				out[p] = merge(ori, value, <any>nex[p]);
			}
			else
			{
				out[p] = value;
			}
		}
        else
        {
            out[p] = convert(value);
        }
    }
    for(const p in original)
    {
        if (p in out) continue;
        out[p] = original[p];
    }
    return out;
}

export function parseJson(text:string):any
{
	try
	{
		return JSON.parse(stripJsonComments(text));
	}
	catch(err)
	{
		const regexp = /^(.+) JSON at position ([0-9]+)$/;
		if (regexp.test(err.message))
		{
			const pos = +RegExp.$2;
			const front = text.substring(0, pos);
			var line = 1;
			var lastidx = 0;
			for (;;)
			{
				const idx = front.indexOf('\n', lastidx);
				if (idx === -1) break;
				line ++;
				lastidx = idx + 1;
			}
			const column = pos - lastidx;
			err.message = `${RegExp.$1} JSON at line ${line}, column ${column}`;
		}
		throw err;
	}
}
