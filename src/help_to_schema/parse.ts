
import * as closure from '../util/closure';
import * as reader from '../util/reader';

closure.help().then(message=>{
	const r = new reader.Reader;
	r.data = message;
	r.skipSpace();
	console.log(message);
});