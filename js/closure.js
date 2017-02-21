
const path = require("path");
const fs = require("fs");
const cp = require('child_process');
const vs = require("./vs");
const util = require("./util");
const glob = require("./glob");
const MakeFile = require("./make");
const config = require('./config');
const vscode = require("vscode");
const stripJsonComments = require('strip-json-comments');
const nfs = require('./fs');

const workspace = vscode.workspace;

/** @type {string} */
const ftpkrRoot = path.join(path.dirname(__filename),'..').replace(/\\/g, '/');

/** @type {string} */
const closurecompiler = ftpkrRoot + "/compiler-latest/closure-compiler-v20170124.jar";


/**
 * @param {Object} orig
 * @param {Object} newo
 * @param {Object=} ex
 */
function iheritOptions(orig, newo, ex)
{
    var conststr = [];
    var arrlist = [];


    function convert(value)
    {
        if (typeof value !== "string") return value;
        
        var nvalue = "";
        var i = 0;
        for(;;)
        {
            var j = value.indexOf("%", i);
            if (j === -1) break;
            var tx = value.substring(i, j);
            j++;
            var k = value.indexOf("%", j);
            if (k === -1) break;
            nvalue += tx;
            var varname = value.substring(j, k);
            if (varname in ex)
            {
                var val = ex[varname];
                if (val instanceof Array)
                {
                    if (val.length === 1)
                    {
                        nvalue += val[0];
                    }
                    else
                    {
                        conststr.push(nvalue);
                        nvalue = '';
                        arrlist.push(val);
                    }
                }
                else
                    nvalue += val;
            }
            else nvalue += "%" + varname + "%";
            i = k + 1;
        }

        nvalue += value.substr(i);
        if (arrlist.length !== 0)
        {
            conststr.push(nvalue);
            var from = [conststr];
            var to = [];
            for(var j=0;j<arrlist.length;j++)
            {
                var list = arrlist[j];
                for(var i=0; i<list.length;i++)
                {
                    for(var k=0;k<from.length;k++)
                    {
                        var cs = from[k];
                        var ncs = cs.slice(1, cs.length);
                        ncs[0] = cs[0] + list[i] + cs[1];
                        to.push(ncs);
                    }
                }
                var t = to;
                to = from;
                from = t;
                to.length = 0;
            }
            for(var i=0;i<from.length;i++)
            {
                from[i] = from[i][0];
            }
            return from;
        }
        return nvalue;
    }
    if(!ex)
    {
        ex = orig;
    }
    else
    {
        for(var p in orig) ex[p] = orig[p];
    }

    var out = {};
    for(var p in newo)
    {
        var value = newo[p];
        if (value instanceof Array)
        {
            var nvalue = [];
            for(var i=0;i<value.length;i++)
            {
                var val = convert(value[i]);
                if (val instanceof Array) nvalue.push.apply(nvalue, val);
                else nvalue.push(val);
            }
            out[p] = nvalue;
        }
        else
        {
            out[p] = convert(value);
        }
    }
    for(var p in orig)
    {
        if (p in out) continue;
        out[p] = orig[p];
    }
    return out;
}

function closure(options)
{
    var projname = options.name;
    var out = options.output;
    var src = options.src;
    if (src.length == 0)
        return Promise.reject(new Error("No source"));
    options.export = !!options.export;
    
    var makeFile = new MakeFile;

    makeFile.on(out, src.concat([options.makejson]), ()=>{
        return new Promise((resolve, reject)=> {
            const curdir = process.cwd();
            try
            {
                process.chdir(options.projectdir);
                util.log(projname + ": BUILD");
                const args = ['-jar', closurecompiler];

                const ex_parameter = {
                    js_output_file_filename: out.substr(out.lastIndexOf("/")+1)
                };
                const parameter = {
                    js: src, 
                    js_output_file: out,
                    generate_exports: options.export
                };

                var finalOptions = iheritOptions(parameter, config.closure, ex_parameter);
                finalOptions = iheritOptions(finalOptions, options.closure, ex_parameter);

                util.addOptions(args, finalOptions);
                const ls = cp.spawn("java", args);
                ls.stdout.on('data', (data) => util.log(data));
                ls.stderr.on('data', (data) => util.log(data));
                ls.on('close', (code) => {
                    if (code === 0)
                    {
                        resolve("COMPLETED");
                    }
                    else
                    {
                        reject(new Error("RESULT: "+code));
                    }
                });
                process.chdir(curdir);
            }
            catch (err)
            {
                process.chdir(curdir);
                reject(err);
            }
        });
    });

    return makeFile.make(out);
}

function include(src)
{
    var includer = new vs.Includer;
    includer.include(src);

    if (includer.errors.length !== 0)
    {
        for(var err of includer.errors)
        {
            util.log(path.resolve(err[0])+":"+err[1]+"\n\t"+err[2]);
        }
    }
    return includer.list;
}

/**
 * @param {string} makejson
 */
function build(makejson)
{
    makejson = path.resolve(makejson).replace(/\\/g, '/');
    const workspacedir = workspace.rootPath.replace(/\\/g, '/'); 
    function toAbsolute(path)
    {
        if (path.startsWith('/'))
            return workspacedir + path;
        else
            return projectdir + "/" + path;
    }

    const projectdir = makejson.substr(0, makejson.lastIndexOf("/"));
    if (!makejson.startsWith(workspacedir))
    {
        return Promise.reject("workspace: " + workspacedir+"\nproject: " + projectdir+"\nout of workspace");
    }
    try
    {
        var options = JSON.parse(stripJsonComments(fs.readFileSync(makejson, 'utf8')));
    }
    catch(err)
    {
		return Promise.reject(err);
    }

    if (!options.name)
        options.name = projectdir;
    options.projectdir = projectdir;

    options.src = options.src instanceof Array ? options.src : [options.src];
    options.makejson = makejson;
    options.output = toAbsolute(options.output);

    var promise = glob(options.src.map(toAbsolute));

    if (options.includeReference !== false)
        promise = promise.then((arg) => options.src = include(arg));

    return promise
    .then(() => closure(options))
    .then((msg) => util.log(options.name + ": "+msg))
    .catch((err) => util.log(err));
}

module.exports = {
    help(){
        cp.spawnSync("java", ["-jar",closurecompiler,"--help"], {stdio: ['inherit', 'inherit', 'inherit']});
    },
    /**
     * @returns {!Promise} 
     */
    all(){
        util.clearLog();
		util.showLog();
        return glob(workspace.rootPath+"/**/make.json")
        .then((files) => util.cascadingPromise(build, files))
        .then(() => util.log('FINISH ALL'))
        .catch((err) => util.log(err))
    },
	/**
	 * @param {string} makejson
	 * @param {string=} input
	 * @return {!Promise}
	 */
	makeJson(makejson, input)
	{
		if (input) input = path.relative(path.dirname(makejson), input).replace(/\\/g, '/');
		else input = "./script.js";
		const output = (input.endsWith('.js') ? input.substring(0, input.length-3) : input) +'.min.js';
		const makejsonDefault = 
		{
			"name": "jsproject",
			"src": input, 
			"output": output,
			"includeReference": true,
			"closure": {}
		};

		try
		{
			makejson = nfs.worklize(makejson);
		}
		catch(e)
		{
			makejson = nfs.workspace+'/';
		}
		return nfs.initJson(makejson, makejsonDefault)
            .then(() => util.open(makejson));
	},
    /**
	 * @param {string} makejs
     * @returns {!Promise} 
     */
    make(makejs){
        util.clearLog();
		util.showLog();
        return build(makejs);
    }
};
