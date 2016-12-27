
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
			var that = this;
			return new Promise(function(resolve, reject){
				that.promise = that.promise
				.then(() => { resolve(); that.busy--; })
				.catch((err) => { reject(err); that.busy--; });
			});
		}
		return this.promise;
	}
	catch(func)
	{
		var that = this;
		return new Promise(function(resolve){
			that.promise = that.end()
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
