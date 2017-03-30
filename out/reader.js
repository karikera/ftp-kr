"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Reader {
    constructor() {
        this.i = 0;
        this.data = "";
    }
    startsWith(str) {
        if (this.data.substr(this.i, str.length) !== str)
            return false;
        this.i += str.length;
        return true;
    }
    startsWithList(strs) {
        for (var i = 0; i < strs.length; i++) {
            if (this.startsWith(strs[i]))
                return strs[i];
        }
        return "";
    }
    peek() {
        return this.data.charAt(this.i);
    }
    skipSpace() {
        for (;;)
            switch (this.peek()) {
                case " ":
                case "\r":
                case "\n":
                case "\t":
                    this.i++;
                    break;
                default: return;
            }
    }
    readTo(chr) {
        if (chr instanceof RegExp) {
            var nidx = this.data.substr(this.i).search(chr);
            if (nidx === -1)
                return null;
            var out = this.data.substr(this.i, nidx);
            this.i = this.i + nidx + RegExp.lastMatch.length;
            return out;
        }
        var nidx = this.data.indexOf(chr, this.i);
        if (nidx === -1)
            return null;
        var out = this.data.substring(this.i, nidx);
        this.i = nidx + chr.length;
        return out;
    }
    space() {
        switch (this.peek()) {
            case " ":
            case "\r":
            case "\n":
            case "\t":
                this.i++;
                this.skipSpace();
                return true;
            default:
                return false;
        }
    }
    readLeft() {
        var out = this.data.substr(this.i);
        this.i = this.data.length;
        return out;
    }
}
exports.Reader = Reader;
class Tag {
    constructor(line, lineNumber) {
        this.lineNumber = lineNumber;
        this.name = "";
        this.props = {};
        if (lineNumber)
            this.lineNumber = lineNumber;
        const tagname = line.readTo(/[ \t]/);
        if (tagname === null) {
            this.name = line.readLeft();
            return;
        }
        this.name = tagname;
        for (;;) {
            line.skipSpace();
            var prop = line.readTo("=");
            if (prop === null)
                break;
            line.skipSpace();
            var start = line.startsWithList(["'", '"']);
            var value = line.readTo(start);
            this.props[prop] = value === null ? '' : value;
        }
    }
}
exports.Tag = Tag;
//# sourceMappingURL=reader.js.map