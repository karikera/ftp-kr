import { SourceMapConsumer, NullableMappedPosition } from 'source-map';
import { File } from 'krfile';
import { replaceErrorUrlAsync } from './util';

const rawSourceMap = {
	version: 3,
	file: 'min.js',
	names: ['bar', 'baz', 'n'],
	sources: ['one.js', 'two.js'],
	sourceRoot: 'http://example.com/www/js/',
	mappings: 'CAAC,IAAI,IAAM,SAAUA,GAClB,OAAOC,IAAID;CCDb,IAAI,IAAM,SAAUE,GAClB,OAAOA'
};

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

export async function getMappedStack(err:any):Promise<string>
{
	if (!err) return err;
	const stack = err.stack;
	if (typeof stack !== 'string') return err;
	
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
	console.error(await getMappedStack(err));
}
