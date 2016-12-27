
const {Tag,Reader} = require("./reader");
const fs = require("fs");
const path = require("path");

class Includer
{
	constructor()
	{
		/** @type {!Object} */
		this.included = {};
		/** @type {!Object} */
		this.including = {};
		/** @type {!Array} */
		this.list = [];
		/** @type {!Array} */
		this.errors = [];
	}

	/**
	 * @param {string|Array.<string>} src
	 * @returns {void}
	 */
	include(src)
	{
		if (src instanceof Array)
		{
			for (var i=0;i<src.length;i++)
			{
				this.include(src[i]);
			}
			return;
		}
		if (src in this.included)
			return;
		if (src in this.including)
			throw Error("SELF_INCLUDE");
		this.included[src] = true;
		this.including[src] = true;

		try
		{
			/** @type {string} */
			var data = fs.readFileSync(src, "utf8");
		}
		catch(e)
		{
			throw Error("FILE_NOT_FOUND");
		}
		/** @type {Array<Tag>} */
		const arr = vs.readXml(data);

		var dir = src.substr(0, src.lastIndexOf("/")+ 1);
		for (const tag of arr)
		{
			switch (tag.name)
			{
			case "reference":
				var file = path.normalize(dir + tag.props.path).replace(/\\/g, "/");
				try
				{
					this.include(file);
				}
				catch(e)
				{
					switch(e.message)
					{
					case "SELF_INCLUDE":
						this.errors.push([src, tag.lineNumber, e.message]);
						break;
					case "FILE_NOT_FOUND":
						this.errors.push([src, tag.lineNumber, "File not found: "+path.resolve(file)]);
						break;
					default: throw e;
					}
				}
				break;
			}
		}
		this.list.push(src);
	}

}


const vs = {
	/**
	 * @param {string} data
	 * @return {Array<Tag>}
	 */
	readXml:function(data)
	{
		const page = new Reader;
		page.data = data;

		var lineNumber = 0;

		const line = new Reader;

		const out = [];
		for(;;)
		{
			page.skipSpace();
			if (!page.startsWith("///")) break;
			
			lineNumber++;
			line.i = 0;
			line.data = page.readTo("\n");
			const close = line.data.lastIndexOf("/>");
			if (close === -1) continue;
			line.data = line.data.substr(0, close);

			line.skipSpace();
			if (!line.startsWith("<")) continue;
			out.push(new Tag(line, lineNumber));
		}
		return out;
	},
	/**
	 * @param {Array.<string>}
	 * @returns {Array.<string>}
	 */
	normalize: function(src)
	{
		var sort = {};
		var j = 0;
		for(var i=0;i<src.length;i++)
		{
			var s = path.resolve(src[i]);
			if (s in sort)
				continue;
			sort[s] = j++;
		}
		var out = [];
		for (var p in sort)
			out[p | 0] = p;
		return out;
	},
	Includer: Includer,
};

module.exports = vs;
