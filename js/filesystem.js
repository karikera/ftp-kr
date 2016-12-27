
/**
 * @param {string} path
 * @return {Array.<string>}
 */
function splitFileName(path)
{
    var pathidx = path.lastIndexOf('/');
    var dir = (pathidx === -1) ? "" : path.substr(0, pathidx);
    return {
        dir: dir,
        name: path.substr(pathidx+1)
    };
}

class State
{
	/**
	 * @param {Directory} parent
	 * @param {string} name
	 */
	constructor(parent, name)
	{
		/** @type {string} */
		this.type = "";
		/** @type{number} */
		this.mtime = 0;
		/** @type{Directory} */
		this.parent = parent ? parent : null;
		/** @type{string} */
		this.name = name;
	}

	/**
	 * @returns {Object}
	 */
	serialize()
	{
		throw new Error("[pure]");
	}
}


class FileCommon extends State
{

	/**
	 * @param {Directory} parent
	 * @param {string} name
	 */
	constructor(parent, name)
	{
		super(parent, name);

		/** @type {number} */
		this.size = 0;
	}
	
	/**
	 * @param {fs.Stat} st
	 * @return {void}
	 */
	setByStat(st)
	{
		this.mtime = +st.mtime;
		this.size = st.size;
	};

	/**
	 * @param {Object} file
	 */
	deserialize(file)
	{
		this.mtime = +file.date;
		if (file.size) this.size = file.size;
	};

	/**
	 * @returns {Object}
	 */
	serialize()
	{
		return {
			type: this.type,
			name: this.name,
			date: this.mtime,
			size: this.size
		};  
	};
}

class Directory extends FileCommon
{
	/**
	 * @param {Directory} parent
	 * @param {string} name
	 */
	constructor(parent, name)
	{
		super(parent, name);

		if (!parent)
			this.parent = this;
		
		/** @type {string} */
		this.type = "d";

		/** @typedef {!Object.<string, State>} */
		this.files = {};
		this.files[""] = this.files["."] = this;
		this.files[".."] = this.parent;
	}
	
	/**
	 * @returns {Object}
	 */
	serialize()
	{
		var out = super.serialize(); 

		var olist = [];
		for(var name in this.files)
		{
			switch(name)
			{
			case "": case ".": case "..": break;
			default: olist.push(this.files[name].serialize()); break;
			}
		}
		out.type = "d";
		out.files = olist;
		return out;
	}

	/**
	 * @param {Object} file
	 * @param {boolean=} add
	 * @returns {void}
	 */
	deserialize(file, add)
	{
		super.deserialize(file, add);
		if (file.files) this.readFiles(file.files, add);
	}

	/**
	 * @param {Array} list
	 * @param {boolean=} add
	 * @returns {void}
	 */
	readFiles(list, add)
	{
		var nfiles = {};
		nfiles["."] = nfiles[""] = this;
		nfiles[".."] = this.parent;

		for(var ftpfile of list)
		{
			_nofile:switch (ftpfile.name)
			{
			case "..": break;
			case ".": this.deserialize(ftpfile, add); break;
			default:
				var file = this.files[ftpfile.name];
				if ((!add) || (!file || file.type !== ftpfile.type))
				{ 
					switch (ftpfile.type)
					{
					case 'd': file = new Directory(this, ftpfile.name); break;
					case '-': file = new File(this, ftpfile.name); break;
					case 'l': file = new SymLink(this, ftpfile.name); break;
					default: break _nofile;
					}
				}
				nfiles[ftpfile.name] = file;
				file.deserialize(ftpfile, add);
				break;
			}
		}
		this.files = nfiles;
	}
}


class SymLink extends FileCommon
{
	/**
	 * @param {Directory} parent
	 * @param {string} name
	 */
	constructor(parent, name)
	{
		super(parent, name);

		/** @type {string} */
		this.type = "l";
		/** @type{string} */
		this.target = "";
	}

	/**
	 * @return {Object}
	 */
	serialize()
	{
		var out = super.serialize();
		out.target = this.target;
		return out;
	};

	/**
	 * @param {Object} file
	 */
	deserialize(file)
	{
		this.target = file.target;
		return super.deserialize(file);
	};

}

class File extends FileCommon
{
	/**
	 * @param {Directory} parent
	 * @param {string} name
	 */
	constructor(parent, name)
	{
		super(parent, name);
		
		/** @type {string} */
		this.type = "-";
	}
}

/**
 * @constructor
 */
class FileSystem
{
	constructor()
	{
		/** @type {Directory} */
		this.root = null;

    	this.reset();
	}
	
	reset()
	{
		this.root = new Directory(null, "");
	}

	/**
	 * @param {string} path
	 * @param {fs.Stat} st
	 * @return {void}
	 */
	putByStat(path, st)
	{
		var file;
		var fn = splitFileName(path);
		var mtime = +st.mtime;
		var dir = this.get(fn.dir, mtime);

		if (st.isSymbolicLink()) file = new SymLink(dir, fn.name);
		else if(st.isDirectory()) file = new Directory(dir, fn.name);
		else if(st.isFile()) file = new File(dir, fn.name);
		file.setByStat(st);
		dir.files[fn.name] = file;
		return file;
	}

	/**
	 * @param {string} path
	 * @param {number=} mtime
	 * @returns {Directory}
	 */
	get(path, mtime)
	{
		var dirs = path.split("/");
		var dir = this.root;
		for(var i=0;i<dirs.length;i++)
		{
			var cd = dirs[i];
			var ndir = (dir instanceof Directory) ? dir.files[cd] : null;
			if(ndir)
			{
				dir = ndir;
				continue;
			}
			if (mtime === undefined)
				return null;
			dir = dir.files[cd] = new Directory(dir, cd);
			dir.mtime = mtime;
		}
		return dir;
	}

	/**
	 * @param {string} path
	 * @param {Array} list
	 * @returns {!Directory}
	 */
	refresh(path, list)
	{
		var dir = this.get(path, 0);
		dir.readFiles(list, true);
		return dir;
	}

	/**
	 * @param {string} path
	 * @param {number} mtime
	 * @returns {!File}
	 */
	create(path, mtime){
		var fn = splitFileName(path);
		var dir = this.get(fn.dir, mtime);
		var file = dir.files[fn.name] = new File(dir, fn.name);
		file.mtime = mtime;
		return file;
	}

	/**
	 * @param {string} path
	 * @returns {void}
	 */
	delete(path){
		var fn = splitFileName(path);
		var dir = this.get(fn.dir);
		if (dir) delete dir.files[fn.name];
	}

	/**
	 * @param {string} path
	 * @param {number} mtime
	 * @returns {Directory}
	 */
	mkdir(path, mtime){
		var dir = this.get(path, mtime);
		dir.mtime = mtime;
		return dir;
	}

	/**
	 * @returns {Object}
	 */
	serialize()
	{
		return this.root.serialize();
	}

	/**
	 * @param {Object} data
	 * @param {boolean=} add
	 * @returns {void}
	 */
	deserialize(data, add)
	{
		return this.root.deserialize(data, add);
	}
}

module.exports = {
    splitFileName: splitFileName,
    State: State,
    File: File,
    Directory: Directory,
    SymLink: SymLink,
    FileSystem: FileSystem,
};