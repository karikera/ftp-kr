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
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const vs = require("./vs");
const util = require("./util");
const pglob_1 = require("./pglob");
const make_1 = require("./make");
const config_1 = require("./config");
const vscode = require("vscode");
const stripJsonComments = require("strip-json-comments");
const nfs = require("./fs");
const workspace = vscode.workspace;
const ftpkrRoot = path.join(path.dirname(__filename), '..').replace(/\\/g, '/');
const closurecompiler = ftpkrRoot + "/compiler-latest/closure-compiler-v20170124.jar";
function closure(options) {
    var projname = options.name;
    var out = options.output;
    var src = options.src;
    if (src.length == 0)
        return Promise.reject(Error("No source"));
    options.export = !!options.export;
    var makeFile = new make_1.default;
    makeFile.on(out, src.concat([options.makejson]), () => {
        return new Promise((resolve, reject) => {
            const curdir = process.cwd();
            try {
                process.chdir(options.projectdir);
                util.log(projname + ": BUILD");
                const args = ['-jar', closurecompiler];
                const ex_parameter = {
                    js_output_file_filename: out.substr(out.lastIndexOf("/") + 1)
                };
                const parameter = {
                    js: src,
                    js_output_file: out,
                    generate_exports: options.export
                };
                var finalOptions = util.merge(parameter, config_1.config.closure, ex_parameter);
                finalOptions = util.merge(finalOptions, options.closure, ex_parameter);
                util.addOptions(args, finalOptions);
                const ls = cp.spawn("java", args);
                ls.stdout.on('data', (data) => util.log(data));
                ls.stderr.on('data', (data) => util.log(data));
                ls.on('close', (code) => {
                    if (code === 0) {
                        resolve("COMPLETED");
                    }
                    else {
                        reject(new Error("RESULT: " + code));
                    }
                });
                process.chdir(curdir);
            }
            catch (err) {
                process.chdir(curdir);
                reject(err);
            }
        });
    });
    return makeFile.make(out).then(v => v ? 'MODIFIED' : 'LATEST');
}
function include(src) {
    var includer = new vs.Includer;
    includer.include(src);
    if (includer.errors.length !== 0) {
        for (var err of includer.errors) {
            util.log(path.resolve(err[0]) + ":" + err[1] + "\n\t" + err[2]);
        }
    }
    return includer.list;
}
function build(makejson) {
    return __awaiter(this, void 0, void 0, function* () {
        makejson = path.resolve(makejson).replace(/\\/g, '/');
        const workspacedir = workspace.rootPath.replace(/\\/g, '/');
        function toAbsolute(path) {
            if (path.startsWith('/'))
                return workspacedir + path;
            else
                return projectdir + "/" + path;
        }
        const projectdir = makejson.substr(0, makejson.lastIndexOf("/"));
        if (!makejson.startsWith(workspacedir)) {
            throw Error("workspace: " + workspacedir + "\nproject: " + projectdir + "\nout of workspace");
        }
        var options = JSON.parse(stripJsonComments(fs.readFileSync(makejson, 'utf8')));
        if (!options.name)
            options.name = projectdir;
        options.projectdir = projectdir;
        options.src = options.src instanceof Array ? options.src : [options.src];
        options.makejson = makejson;
        options.output = toAbsolute(options.output);
        const arg = yield pglob_1.default(options.src.map(toAbsolute));
        if (options.includeReference !== false)
            options.src = include(arg);
        try {
            const msg = yield closure(options);
            util.log(options.name + ": " + msg);
        }
        catch (err) {
            util.log(err);
        }
    });
}
function help() {
    cp.spawnSync("java", ["-jar", closurecompiler, "--help"], { stdio: ['inherit', 'inherit', 'inherit'] });
}
exports.help = help;
function all() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            util.clearLog();
            util.showLog();
            const files = yield pglob_1.default(workspace.rootPath + "/**/make.json");
            yield util.cascadingPromise(build, files);
            util.log('FINISH ALL');
        }
        catch (err) {
            util.log(err);
        }
    });
}
exports.all = all;
function makeJson(makejson, input) {
    if (input)
        input = path.relative(path.dirname(makejson), input).replace(/\\/g, '/');
    else
        input = "./script.js";
    const output = (input.endsWith('.js') ? input.substring(0, input.length - 3) : input) + '.min.js';
    const makejsonDefault = {
        name: "jsproject",
        src: input,
        output: output,
        includeReference: true,
        closure: {}
    };
    try {
        makejson = nfs.worklize(makejson);
    }
    catch (e) {
        makejson = nfs.workspace + '/';
    }
    return nfs.initJson(makejson, makejsonDefault)
        .then(() => util.open(makejson));
}
exports.makeJson = makeJson;
function make(makejs) {
    util.clearLog();
    util.showLog();
    return build(makejs);
}
exports.make = make;
//# sourceMappingURL=closure.js.map