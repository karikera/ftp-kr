"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cp = require("child_process");
const path = require("path");
const util = require("./util");
function gen(jsfile) {
    return new Promise((res, rej) => {
        util.showLog();
        jsfile = path.resolve(jsfile);
        const jsfiledir = path.dirname(jsfile);
        const proc = cp.fork(`${__dirname}/externgen_sandbox.js`, [jsfile], { cwd: jsfiledir });
        var end = false;
        proc.on('message', data => {
            if (typeof data === 'string') {
                util.log(data);
                return;
            }
            end = true;
            if (data.error) {
                rej(Error(data.error));
            }
            else {
                util.log(data.output);
                res();
            }
        });
        proc.on('close', exitCode => {
            if (!end)
                rej(Error('exit code:' + exitCode));
        });
    });
}
exports.gen = gen;
//# sourceMappingURL=externgen.js.map