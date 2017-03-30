"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const reader_1 = require("./reader");
const fs = require("fs");
const path = require("path");
class Includer {
    constructor() {
        this.included = {};
        this.including = {};
        this.list = [];
        this.errors = [];
    }
    include(src) {
        if (src instanceof Array) {
            for (var i = 0; i < src.length; i++) {
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
        try {
            var data = fs.readFileSync(src, "utf8");
        }
        catch (e) {
            throw Error("FILE_NOT_FOUND");
        }
        const arr = readXml(data);
        var dir = src.substr(0, src.lastIndexOf("/") + 1);
        for (const tag of arr) {
            switch (tag.name) {
                case "reference":
                    var file = path.normalize(dir + tag.props.path).replace(/\\/g, "/");
                    try {
                        this.include(file);
                    }
                    catch (e) {
                        switch (e.message) {
                            case "SELF_INCLUDE":
                                this.errors.push([src, tag.lineNumber, e.message]);
                                break;
                            case "FILE_NOT_FOUND":
                                this.errors.push([src, tag.lineNumber, "File not found: " + path.resolve(file)]);
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
exports.Includer = Includer;
function readXml(data) {
    const page = new reader_1.Reader;
    page.data = data;
    var lineNumber = 0;
    const line = new reader_1.Reader;
    const out = [];
    for (;;) {
        page.skipSpace();
        if (!page.startsWith("///"))
            break;
        lineNumber++;
        line.i = 0;
        var linestr = page.readTo("\n");
        ;
        if (!linestr)
            continue;
        line.data = linestr;
        const close = line.data.lastIndexOf("/>");
        if (close === -1)
            continue;
        line.data = line.data.substr(0, close);
        line.skipSpace();
        if (!line.startsWith("<"))
            continue;
        out.push(new reader_1.Tag(line, lineNumber));
    }
    return out;
}
exports.readXml = readXml;
function normalize(src) {
    const sort = new Set();
    for (const s of src) {
        sort.add(path.resolve(s));
    }
    return [...sort.values()].sort();
}
exports.normalize = normalize;
//# sourceMappingURL=vs.js.map