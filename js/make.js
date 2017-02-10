
const util = require("./util");
const fs = require("fs");

class MakeFileItem
{
	/**
	 * @param {!Array<string>} children
	 * @param {!Function} callback
	 */
	constructor(children, callback)
	{
		/** @type {!Array<string>} */
		this.children = children;
		/** @type {!Function} */
		this.callback = callback;
	}
}

class MakeFile
{
	constructor()
	{
		/** @type {Object<string, MakeFileItem>} */
		this.map = {};
	}

	/**
	 * @param {string} master
	 * @param {Array<string>} children
	 * @param {!Function} callback
	 */
	on(master, children, callback)
	{
		this.map[master] = new MakeFileItem(children, callback);
	}

	/**
	 * @param {string} target
	 */
	make(target)
	{
		function buildChild(child)
		{
			return that.make(child).then(mod=>{
				modified = modified || mod;
				if (modified) return;
				
				try
				{
					const stat = fs.statSync(target);
					if(!mtime) mtime = +stat.mtime;
				}
				catch(err)
				{
					mtime = -1;
				}
				const stat = fs.statSync(child);
				if (mtime <= +stat.mtime)
				modified = true;
			});
		}

		const that = this;
		var mtime = 0;
		/** @type {MakeFileItem} */
		const options = this.map[target];
		if (!options)
			return Promise.resolve(false);

		const children = options.children;
		if (children.length === 0)
			return options.callback();

		var modified = false;        
		return util.cascadingPromise(buildChild, children).then(function(){
			if (modified) return options.callback();
			return Promise.resolve("LATEST");
		});
	}
}

module.exports = MakeFile;
