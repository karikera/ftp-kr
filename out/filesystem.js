"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function splitFileName(path) {
    var pathidx = path.lastIndexOf('/');
    var dir = (pathidx === -1) ? "" : path.substr(0, pathidx);
    return {
        dir: dir,
        name: path.substr(pathidx + 1)
    };
}
exports.splitFileName = splitFileName;
class State {
    constructor(parent, name) {
        this.name = name;
        this.type = "";
        this.lmtime = 0;
        this.ignoreUploadTime = 0;
        if (parent)
            this.parent = parent;
        else if (this instanceof Directory)
            this.parent = this;
        else
            throw TypeError('Internal error, construct State without directory parameter');
    }
}
exports.State = State;
class FileCommon extends State {
    constructor(parent, name) {
        super(parent, name);
        this.size = 0;
    }
    setByStat(st) {
        this.size = st.size;
    }
    deserialize(file, add) {
        if (file.size !== undefined)
            this.size = file.size;
    }
    serialize() {
        return {
            type: this.type,
            name: this.name,
            size: this.size
        };
    }
}
exports.FileCommon = FileCommon;
class Directory extends FileCommon {
    constructor(parent, name) {
        super(parent, name);
        this.files = {};
        this.type = "d";
        this.files[""] = this.files["."] = this;
        this.files[".."] = this.parent;
    }
    serialize() {
        const out = super.serialize();
        var olist = [];
        for (var name in this.files) {
            switch (name) {
                case "":
                case ".":
                case "..": break;
                default:
                    olist.push(this.files[name].serialize());
                    break;
            }
        }
        out.type = "d";
        out.files = olist;
        return out;
    }
    deserialize(file, add) {
        super.deserialize(file, add);
        if (file.files)
            this.readFiles(file.files, add);
    }
    readFiles(list, add) {
        var nfiles = {};
        nfiles["."] = nfiles[""] = this;
        nfiles[".."] = this.parent;
        for (var ftpfile of list) {
            _nofile: switch (ftpfile.name) {
                case undefined: break;
                case "..": break;
                case ".":
                    this.deserialize(ftpfile, add);
                    break;
                default:
                    var file = this.files[ftpfile.name];
                    if ((!add) || (!file || file.type !== ftpfile.type)) {
                        switch (ftpfile.type) {
                            case 'd':
                                file = new Directory(this, ftpfile.name);
                                break;
                            case '-':
                                file = new File(this, ftpfile.name);
                                break;
                            case 'l':
                                file = new SymLink(this, ftpfile.name);
                                break;
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
exports.Directory = Directory;
class SymLink extends FileCommon {
    constructor(parent, name) {
        super(parent, name);
        this.target = '';
        this.type = 'l';
    }
    serialize() {
        var out = super.serialize();
        out.target = this.target;
        return out;
    }
    deserialize(file) {
        if (file.target)
            this.target = file.target;
        return super.deserialize(file);
    }
}
exports.SymLink = SymLink;
class File extends FileCommon {
    constructor(parent, name) {
        super(parent, name);
        this.type = "-";
    }
}
exports.File = File;
class FileSystem {
    constructor() {
        this.reset();
    }
    reset() {
        this.root = new Directory(null, "");
    }
    putByStat(path, st) {
        var file;
        var fn = splitFileName(path);
        var dir = this.get(fn.dir, true);
        if (st.isSymbolicLink())
            file = new SymLink(dir, fn.name);
        else if (st.isDirectory())
            file = new Directory(dir, fn.name);
        else if (st.isFile())
            file = new File(dir, fn.name);
        file.setByStat(st);
        dir.files[fn.name] = file;
        return file;
    }
    get(path, make) {
        const dirs = path.split("/");
        var dir = this.root;
        for (const cd of dirs) {
            const ndir = dir.files[cd];
            if (ndir) {
                if (ndir instanceof Directory) {
                    dir = ndir;
                    continue;
                }
            }
            if (!make)
                return null;
            dir = dir.files[cd] = new Directory(dir, cd);
        }
        return dir;
    }
    refresh(path, list) {
        const dir = this.get(path, true);
        dir.readFiles(list, true);
        return dir;
    }
    create(path) {
        const fn = splitFileName(path);
        const dir = this.get(fn.dir, true);
        const file = dir.files[fn.name] = new File(dir, fn.name);
        return file;
    }
    delete(path) {
        const fn = splitFileName(path);
        const dir = this.get(fn.dir);
        if (dir)
            delete dir.files[fn.name];
    }
    mkdir(path) {
        return this.get(path, true);
    }
    serialize() {
        return this.root.serialize();
    }
    deserialize(data, add) {
        this.root.deserialize(data, add);
    }
}
exports.FileSystem = FileSystem;
//# sourceMappingURL=filesystem.js.map