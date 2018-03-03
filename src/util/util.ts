
import stripJsonComments = require('strip-json-comments');

export class Deferred<T> implements Promise<T>
{
	public resolve:((v?:T)=>void);
	public reject:((v?:any)=>void);
	public readonly [Symbol.toStringTag] = "Promise";
	private promise:Promise<T>;

	constructor()
	{
		this.resolve = <any>undefined;
		this.reject = <any>undefined;
		this.promise = new Promise<T>((res, rej)=>{
			this.resolve = res;
			this.reject = rej;
		});
	}
	
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

export function addOptions(args:string[], options:{[key:string]:any}):void
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
                var val = nex[<keyof T>varname];
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

export function promiseErrorWrap<T>(prom:Promise<T>):Promise<T>
{
	const stack = Error().stack || '';
	return prom.catch(err=>{
		if (err && err.stack)
		{
			if (!err.__messageCodeAttached && err.code)
			{
				err.message = err.message + "[" + err.code + "]";
				err.__messageCodeAttached = true;
			}
			err.stack = err.stack + stack.substr(stack.indexOf('\n'));
		}
		throw err;
	});
}

export function replaceErrorUrl(stack:string, foreach:(path:string, line:number, column:number)=>string):string
{
	const regexp = /^\tat ([^(\n]+) \(([^)\n]+)\:([0-9]+)\:([0-9]+)\)$/gm;
	var arr:RegExpExecArray|null;
	var lastIndex = 0;
	var out = '';
	while (arr = regexp.exec(stack))
	{
		out += stack.substring(lastIndex, arr.index);
		out += '\tat ';
		out += arr[1];
		out += ' (';
		out += foreach(arr[2], +arr[3], +arr[4]);
		out += ')';
		lastIndex = regexp.lastIndex;
	}
	out += stack.substr(lastIndex);
	return out;
}

export async function replaceErrorUrlAsync(stack:string, foreach:(path:string, line:number, column:number)=>Promise<string>):Promise<string>
{
	const regexp = /^\tat ([^(\n]+) \(([^)\n]+)\:([0-9]+)\:([0-9]+)\)$/gm;
	var arr:RegExpExecArray|null;
	var lastIndex = 0;
	var out = '';
	while (arr = regexp.exec(stack))
	{
		out += stack.substring(lastIndex, arr.index);
		out += '\tat ';
		out += arr[1];
		out += ' (';
		out += await foreach(arr[2], +arr[3], +arr[4]);
		out += ')';
		lastIndex = regexp.lastIndex;
	}
	out += stack.substr(lastIndex);
	return out;
}
