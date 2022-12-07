import { File } from 'krfile';
import { SourceMapConsumer } from 'source-map';
import { replaceErrorUrlAsync } from './util';

export async function getTsPosition(js:File, line:number, column:number):Promise<{source:string, line:number, column:number}>
{
	try
	{
		const sm = await js.reext('js.map').json();
		const res = await SourceMapConsumer.with(sm, null, consumer => consumer.originalPositionFor({line,column}));

		const source = res.source ? js.child(res.source).fsPath : js.fsPath;
		return {source, line: res.line || line, column: res.column || column };
	}
	catch (err)
	{
		return {source:js.fsPath, line, column};
	}
}

export async function getMappedStack(err:any):Promise<string|null>
{
	if (!err) return null;
	const stack = err.stack;
	if (typeof stack !== 'string') return null;
	
	return replaceErrorUrlAsync(stack, async(path, line, column)=>{
		const pos = await getTsPosition(new File(path), line, column);
		var res = '';
		res += pos.source;
		res += ':';
		res += pos.line;
		res += ':';
		res += pos.column;
		return res;
	});
}

export async function printMappedError(err:any):Promise<void>
{
	const stack = await getMappedStack(err);
	console.error(stack || err);
}
