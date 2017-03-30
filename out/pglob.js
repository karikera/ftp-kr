"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const glob_inner = require("glob");
const util = require("./util");
function glob(pattern) {
    pattern = pattern.replace(/\\/g, "/");
    return new Promise((resolve, reject) => {
        glob_inner(pattern, (err, files) => {
            if (err)
                reject(err);
            else
                resolve(files);
        });
    });
}
function globAll(files) {
    return util.cascadingPromise(glob, files)
        .then((fileses) => [].concat(...fileses));
}
function default_1(pattern) {
    if (pattern instanceof Array)
        return globAll(pattern);
    return glob(pattern);
}
exports.default = default_1;
;
//# sourceMappingURL=pglob.js.map