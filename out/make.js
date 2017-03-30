"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
class MakeFileItem {
    constructor(children, callback) {
        this.children = children;
        this.callback = callback;
    }
}
class MakeFile {
    constructor() {
        this.map = new Map();
    }
    on(master, children, callback) {
        this.map.set(master, new MakeFileItem(children, callback));
    }
    make(target) {
        return __awaiter(this, void 0, void 0, function* () {
            const that = this;
            var mtime = 0;
            const options = this.map.get(target);
            if (!options)
                return false;
            const children = options.children;
            if (children.length === 0)
                return options.callback();
            var modified = false;
            for (const child of children) {
                const mod = yield that.make(child);
                modified = modified || mod;
                if (!modified) {
                    try {
                        const stat = fs.statSync(target);
                        if (!mtime)
                            mtime = +stat.mtime;
                    }
                    catch (err) {
                        mtime = -1;
                    }
                    const stat = fs.statSync(child);
                    if (mtime <= +stat.mtime)
                        modified = true;
                }
            }
            if (modified)
                return options.callback();
            return modified;
        });
    }
}
exports.default = MakeFile;
//# sourceMappingURL=make.js.map