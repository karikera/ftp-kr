
class Work
{
	promise:Promise<void> = Promise.resolve();
	reserved:string[] = [];

	work(name:string, func:()=>any):Promise<any>
	{
		if (this.reserved.length !== 0)
		{
			return Promise.reject('ftp-kr is busy: '+this.reserved[0]+' is being proceesed('+name+')');
		}
		return this.reserveWork(name, func);
	}
	reserveWork(name:string, func:()=>any):Promise<any>
	{
		this.reserved.push(name);
		const prom = this.promise.then(func)
		.then(v=>{
			this.reserved.shift();
			return v;
		});
		this.promise = prom.catch(err=>{
			this.reserved.shift();
		});
		return prom;
	}
}

export const compile = new Work;
export const ftp = new Work;
export const load = new Work;

