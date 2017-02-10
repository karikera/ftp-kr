
class Work
{
	constructor()
	{
		/** @type {!Promise} */
		this.promise = Promise.resolve();
		/** @type {number} */
		this.busy = 0;
		/** @type {boolean} */
		this.endIsBusy = false;
	}

	add(func)
	{
		if (!this.endIsBusy)
		{
			this.busy++;
			this.endIsBusy = true;
		}
		this.promise = this.promise.then(func);
		return this;
	}
	end()
	{
		if (this.endIsBusy)
		{
			this.endIsBusy = false;
			return new Promise((resolve, reject)=>{
				this.promise = this.promise
				.then(() => { resolve(); this.busy--; })
				.catch((err) => { reject(err); this.busy--; });
			});
		}
		return this.promise;
	}
	catch(func)
	{
		return new Promise(resolve=>{
			this.promise = this.end()
			.then((data) => resolve(data))
			.catch((err) => resolve(func(err)))
		});
	}
	then(func)
	{
		return this.end().then(func);
	}

}

module.exports = {
    compile: new Work,
    ftp: new Work,
    load: new Work
};
