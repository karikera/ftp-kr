
/**
 * @constructor
 */
function Work()
{
    this.promise = Promise.resolve();
}

/** @type {!Promise} */
Work.prototype.promise = null;
/** @type {number} */
Work.prototype.busy = 0;
/** @type {boolean} */
Work.prototype.endIsBusy = false;

Work.prototype.add = function(func)
{
    if (!this.endIsBusy)
    {
        this.busy++;
        this.endIsBusy = true;
    }
    this.promise = this.promise.then(func);
    return this;
};
Work.prototype.end = function()
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
};
Work.prototype.catch = function(func)
{
    var that = this;
    return new Promise(function(resolve){
        that.promise = that.end()
        .then((data) => resolve(data))
        .catch((err) => resolve(func(err)))
    });
};
Work.prototype.then = function(func)
{
    return this.end().then(func);
};

module.exports = {
    compile: new Work,
    ftp: new Work,
    load: new Work
};
