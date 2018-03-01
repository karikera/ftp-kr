import { SourceMapConsumer, NullableMappedPosition } from 'source-map';
import { File } from 'krfile';

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
	
	const regexp = /^\tat ([^(\n]+) \(([^)\n]+)\:([0-9]+)\:([0-9]+)\)$/gm;
	var out = '';
	var arr:RegExpExecArray|null;
	var lastIndex = 0;
/**
	at Object.parseJson (d:\Projects\git\ftp-kr\node_modules\krjson\out\index.js:23:21)
	at Config.set (d:\Projects\git\ftp-kr\out\util\ftpkr_config.js:202:28)
	at Config.<anonymous> (d:\Projects\git\ftp-kr\out\util\ftpkr_config.js:345:18)
	at Generator.next (<anonymous>)
	at fulfilled (d:\Projects\git\ftp-kr\out\util\ftpkr_config.js:4:58)
	at <anonymous>"

 */
	while (arr = regexp.exec(stack))
	{
		const pos = await getTsPosition(new File(arr[2]), +arr[3], +arr[4]);
		out += stack.substring(lastIndex, arr.index);
		out += '\tat ';
		out += arr[1];
		out += ' (';
		out += pos.source;
		out += ':';
		out += pos.line;
		out += ':';
		out += pos.column;
		out += ')';
		lastIndex = regexp.lastIndex;
	}
	out += stack.substr(lastIndex);
	return out;
}

export async function printMappedError(err:any):Promise<void>
{
	console.error(await getMappedStack(err));
}
