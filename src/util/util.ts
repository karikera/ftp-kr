
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

export function getFilePosition(content:string, index:number):{line:number,column:number}
{
	const front = content.substring(0, index);
	var line = 1;
	var lastidx = 0;
	for (;;)
	{
		const idx = front.indexOf('\n', lastidx);
		if (idx === -1) break;
		line ++;
		lastidx = idx + 1;
	}
	return {
		line,
		column:index - lastidx
	};
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
			const index = +RegExp.$2;
			const {line, column} = getFilePosition(text, index);
			err.line = line;
			err.column = column;
			err.message = `${RegExp.$1} JSON at line ${line}, column ${column}`;
		}
		throw err;
	}
}

export function callbackToPromise<T>(call:(callback:(err:Error, value?:T)=>void)=>void):Promise<T>
{
	const savedStack = new Error('').stack || '';
	
    return new Promise<T>((resolve, reject)=>{
        call((err, data)=>{
			if (err)
			{
				var stackline = savedStack.indexOf('\n');
				stackline = savedStack.indexOf('\n', stackline+1);
				if (stackline !== -1)
				{
					err.stack = err.message + savedStack.substr(stackline);
				}
				reject(err);
			}
            else resolve(data);
        });
    });
}

export function clone<T>(value:T):T
{
	if (!(value instanceof Object)) return value;
	if (value instanceof Array)
	{
		const arr = new Array(value.length);
		for (var i=0;i<arr.length;i++)
		{
			arr[i] = clone(value[i]);
		}
		return <any>arr;
	}
	if (value instanceof Map)
	{
		const map = new Map(value.entries());
		return <any>map;
	}
	if (value instanceof Set)
	{
		const set = new Set(value.values());
		return <any>set;
	}
	if (value instanceof RegExp)
	{
		return value;
	}
	const nobj:{[key:string]:any} = new Object;
	nobj.__proto__ = (<any>value).__proto__;

	for (const p in value)
	{
		nobj[p] = value[p];
	}
	return <any>nobj;
}
