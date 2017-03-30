
class Work implements Thenable<any>
{
	promise:Promise<void> = Promise.resolve();
	busy:number = 0;
	endIsBusy:boolean = false;

	add(func:()=>any):this
	{
		if (!this.endIsBusy)
		{
			this.busy++;
			this.endIsBusy = true;
		}
		this.promise = this.promise.then(func);
		return this;
	}

	end():Promise<any>
	{
		if (this.endIsBusy)
		{
			this.endIsBusy = false;
			return new Promise<void>((resolve, reject)=>{
				this.promise = this.promise
				.then(() => { resolve(); this.busy--; })
				.catch((err) => { reject(err); this.busy--; });
			});
		}
		return this.promise;
	}

	catch(func:(v:any)=>any):Promise<any>
	{
		return new Promise(resolve=>{
			this.promise = this.end()
			.then((data) => resolve(data))
			.catch((err) => resolve(func(err)))
		});
	}

	then(func:()=>any):Promise<any>
	{
		return this.end().then(func);
	}

}

export const compile = new Work;
export const ftp = new Work;
export const load = new Work;

