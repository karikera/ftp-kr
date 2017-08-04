
class Work
{
	promise:Promise<void> = Promise.resolve();
	commandName:string = '';

	work(name:string, func:()=>any):Promise<any>
	{
		if (this.commandName !== '')
		{
			return Promise.reject('ftp-kr is busy: '+this.commandName+' is being proceesed');
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
}

export const compile = new Work;
export const ftp = new Work;
export const load = new Work;

