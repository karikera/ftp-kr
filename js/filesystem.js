
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

/**
 * @constructor
 * @param {Directory} parent
 * @param {string} name
 */
function State(parent, name)
{
    this.parent = parent ? parent : null;
    this.name = name;
}


/** @type {string} */
State.prototype.type = "";
/** @type{number} */
State.prototype.mtime = 0;
/** @type{Directory} */
State.prototype.parent = null;
/** @type{string} */
State.prototype.name = "";

/**
 * @returns {Object}
 */
State.prototype.serialize = function()
{
    throw new Error("[pure]");
};

/**
 * @constructor
 * @extends {State} 
 * @param {Directory} parent
 * @param {string} name
 */
function FileCommon(parent, name)
{
    State.apply(this, [parent, name]);
}

FileCommon.prototype = Object.create(State.prototype);

/** @type {string} */
FileCommon.prototype.size = 0;

/**
 * @param {fs.Stat} st
 * @return {void}
 */
FileCommon.prototype.setByStat = function(st)
{
    this.mtime = +st.mtime;
    this.size = st.size;
};

/**
 * @param {Object} file
 */
FileCommon.prototype.deserialize = function(file)
{
    this.mtime = +file.date;
    if (file.size) this.size = file.size;
};

/**
 * @returns {Object}
 */
FileCommon.prototype.serialize = function()
{
    return {
        type: this.type,
        name: this.name,
        date: this.mtime,
        size: this.size
    };  
};


/**
 * @constructor
 * @extends {FileCommon} 
 * @param {Directory} parent
 * @param {string} name
 */
function Directory(parent, name)
{
    FileCommon.apply(this, [parent, name]);
    if (!parent)
        this.parent = this;
    this.files = {};
    this.files[""] = this.files["."] = this;
    this.files[".."] = this.parent;
}

Directory.prototype = Object.create(FileCommon.prototype);

/** @type {string} */
Directory.prototype.type = "d";

/** @typedef {Object.<string, State>} Directory */
Directory.prototype.files = null;

/**
 * @returns {Object}
 */
Directory.prototype.serialize = function()
{
    var out = FileCommon.prototype.serialize.apply(this); 

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
};

/**
 * @param {Object} file
 * @param {boolean=} add
 * @returns {void}
 */
Directory.prototype.deserialize = function(file, add)
{
    FileCommon.prototype.deserialize.call(this, file, add);
    if (file.files) this.readFiles(file.files, add);
};

/**
 * @param {Array} list
 * @param {boolean=} add
 * @returns {void}
 */
Directory.prototype.readFiles = function(list, add)
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
};

/**
 * @constructor
 * @extends {FileCommon}
 * @param {Directory} parent
 * @param {string} name
 */
function SymLink(parent, name)
{
    FileCommon.apply(this, [parent, name]);
}

SymLink.prototype = Object.create(FileCommon.prototype);

/** @type {string} */
SymLink.prototype.type = "l";

/** @type{string} */
SymLink.prototype.target = "";

/**
 * @return {Object}
 */
SymLink.prototype.serialize = function()
{
    var out = FileCommon.prototype.serialize.apply(this);
    out.target = this.target;
    return out;
};

/**
 * @param {Object} file
 */
SymLink.prototype.deserialize = function(file)
{
    this.target = file.target;
    return FileCommon.prototype.deserialize.apply(this, arguments);
};

/**
 * @constructor
 * @extends {FileCommon}
 * @param {Directory} parent
 * @param {string} name
 */
function File(parent, name)
{
    FileCommon.apply(this, [parent, name]);
}

File.prototype = Object.create(FileCommon.prototype);

/** @type {string} */
File.prototype.type = "-";


/**
 * @constructor
 */
function FileSystem()
{
    this.reset();
}

/** @type {Directory} */
FileSystem.prototype.root = null;

FileSystem.prototype.reset = function()
{
    this.root = new Directory(null, "");
};

/**
 * @param {string} path
 * @param {fs.Stat} st
 * @return {void}
 */
FileSystem.prototype.putByStat = function(path, st)
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
};

/**
 * @param {string} path
 * @param {number=} mtime
 * @returns {Directory}
 */
FileSystem.prototype.get = function(path, mtime)
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
};

/**
 * @param {string} path
 * @param {Array} list
 * @returns {!Directory}
 */
FileSystem.prototype.refresh = function(path, list)
{
    var dir = this.get(path, 0);
    dir.readFiles(list, true);
    return dir;
};

/**
 * @param {string} path
 * @param {number} mtime
 * @returns {!File}
 */
FileSystem.prototype.create = function(path, mtime){
    var fn = splitFileName(path);
    var dir = this.get(fn.dir, mtime);
    var file = dir.files[fn.name] = new File(dir, fn.name);
    file.mtime = mtime;
    return file;
};

/**
 * @param {string} path
 * @returns {void}
 */
FileSystem.prototype.delete = function(path){
    var fn = splitFileName(path);
    var dir = this.get(fn.dir);
    if (dir) delete dir.files[fn.name];
};

/**
 * @param {string} path
 * @param {number} mtime
 * @returns {Directory}
 */
FileSystem.prototype.mkdir = function(path, mtime){
    return this.get(path, mtime);
};

/**
 * @returns {Object}
 */
FileSystem.prototype.serialize = function()
{
    return this.root.serialize();
};

/**
 * @param {Object} data
 * @param {boolean=} add
 * @returns {void}
 */
FileSystem.prototype.deserialize = function(data, add)
{
    return this.root.deserialize(data, add);
};


module.exports = {
    splitFileName: splitFileName,
    State: State,
    File: File,
    Directory: Directory,
    SymLink:SymLink,
    FileSystem: FileSystem,
};