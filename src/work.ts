
class Work
{
	promise:Promise<void> = Promise.resolve();
	commandName:string = '';
	reserved:Array<string> = [];

	work(name:string, func:()=>any):Promise<any>
	{
		if (this.commandName !== '')
		{
			return Promise.reject('ftp-kr is busy: '+this.commandName+' is being proceesed('+name+')');
		}
		if (this.reserved.length !== 0)
		{
			return Promise.reject('ftp-kr is busy: '+this.reserved[0]+' is being proceesed('+name+')');
		}
		this.commandName = name;
		const prom = this.promise.then(func)
		.then(v=>{
			this.commandName = '';
			return v;
		});
		this.promise = prom.catch(err=>{
			this.commandName = '';
		});
		return prom;
	}
	reserveWork(name:string, func:()=>any):Promise<any>
	{
		this.reserved.push(name);
		const prom = this.promise.then(func)
		.then(v=>{
			this.reserved.pop();
			return v;
		});
		this.promise = prom.catch(err=>{
			this.reserved.pop();
		});
		return prom;
	}
}

export const compile = new Work;
export const ftp = new Work;
export const load = new Work;

