"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const getParameterNames = require("get-parameter-names");
class Printer {
    constructor() {
        this.output = '';
        this.space = '';
        this.spaceWrited = false;
    }
    reduce() {
        this.output = this.output.substr(0, this.output.length - 1);
    }
    open() {
        this.print('{');
        this.space += '\t';
    }
    close() {
        this.space = this.space.substr(0, this.space.length - 1);
        this.print('}');
    }
    print(text) {
        if (!this.spaceWrited) {
            this.output += this.space;
            this.spaceWrited = true;
        }
        this.output += text;
    }
    lineFeed() {
        this.output += '\n';
        this.spaceWrited = false;
    }
}
const cls = new Printer;
const out = new Printer;
function outFunctionPost(value) {
    out.print('(');
    const paramNames = getParameterNames(value);
    out.print(paramNames.join(','));
    out.print('){}');
    //out.print(JSON.stringify(func));
}
function outValue(prefix, value, postfix) {
    switch (typeof value) {
        case 'string':
            out.print(prefix + JSON.stringify(value) + postfix);
            break;
        case 'number':
        case 'undefined':
            out.print(`${prefix}${value}${postfix}`);
            break;
        case 'object':
            out.print(`${prefix}`);
            switch (value.constructor) {
                case Array:
                    out.print(`[]`);
                    break;
                case Function:
                    out.print(`function`);
                    outFunctionPost(value);
                    break;
                default:
                    out.open();
                    for (const member in value) {
                        out.lineFeed();
                        outMember(member, value[member]);
                    }
                    out.reduce();
                    out.lineFeed();
                    out.close();
                    break;
            }
            out.print(`${postfix}`);
            break;
        default:
            out.print(`// unknown type: ${typeof value}`);
            break;
    }
}
function outMember(varname, value) {
    if (value && value.constructor === Function) {
        out.print(varname);
        outFunctionPost(value);
        out.print(',');
    }
    else {
        outValue(`${varname}:`, value, ',');
    }
}
function outGlobal(varname, value) {
    if (value && value.constructor === Function) {
        out.print('function ');
        out.print(varname);
        outFunctionPost(value);
    }
    else {
        outValue(`var ${varname}=`, value, ';');
    }
}
if (!process.send) {
    console.error('This process must be worker');
}
else {
    try {
        class Element {
        }
        global['Element'] = Element;
        global['self'] = global;
        global['location'] = {};
        global['document'] = {
            getElementsByTagName() {
                return new Element;
            },
        };
        const postrun = [() => { }];
        global['requestAnimationFrame'] = function (fn) {
            postrun.push(fn);
        };
        global['set' + 'Timeout'] = global['set' + 'Interval'] = function (callback, delay, ...args) {
            const id = postrun.length;
            postrun.push(callback.bind(global, ...args));
            return id;
        };
        global['clear' + 'Timeout'] = global['clear' + 'Interval'] = function (id) {
            postrun[id] = function () { };
        };
        const ignores = new Set();
        for (const varname in global) {
            ignores.add(varname);
        }
        const filename = process.argv[2];
        const source = fs.readFileSync(filename, 'utf-8');
        try {
            eval.apply(global, source);
            for (const run of postrun.slice())
                run();
        }
        catch (e) {
            const message = { output: '', error: e.stack.replace(/at eval \(eval at <anonymous> \(.+\), <anonymous>:([0-9]+):([0-9]+)\)/g, `at Object.<anonymous> (${filename}:$1$2)`) };
            process.send(message);
            process.exit(-1);
        }
        for (const varname in global) {
            if (ignores.has(varname))
                continue;
            outGlobal(varname, global[varname]);
        }
    }
    catch (e) {
        process.send({ output: '', error: e.stack });
        process.exit(-1);
    }
    process.send({ output: '/** @externs */\n' + cls.output + '\n' + out.output, error: null });
}
//# sourceMappingURL=externgen_sandbox.js.map