
var path = require("path");
var util = require("util");
var fs = require("fs");
var cp = require('child_process');
var vs = require("./vs");
var util = require("./util");
var glob = require("./glob");
var MakeFile = require("./make");
var config = require('./config');
var vscode = require("vscode");

var workspace = vscode.workspace;

/** @type {string} */
var ftpkrRoot = __filename.replace(/\\/g, '/');
ftpkrRoot = ftpkrRoot.substr(0, ftpkrRoot.lastIndexOf("/", ftpkrRoot.lastIndexOf("/")-1));

/** @type {string} */
var closurecompiler = ftpkrRoot + "/compiler-latest/closure-compiler-v20160911.jar";

/**
 * @param {Object} orig
 * @param {Object} newo
 * @param {Object=} ex
 */
function iheritOptions(orig, newo, ex)
{
    function convert(value)
    {
        if (typeof value !== "string") return value+"";
        
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
            if (varname in ex) nvalue += ex[varname];
            else nvalue += "%" + varname + "%";
            i = k + 1;
        }
        return nvalue + value.substr(i);
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
            out[p] = value.map(convert);
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

    makeFile.on(out, src.concat([options.makejson]), function(){
        return new Promise(function(resolve, reject) {
            util.log(projname + ": BUILD");
            var args = ['-jar', closurecompiler];

            var ex_parameter = {
                js_output_file_filename: out.substr(out.lastIndexOf("/")+1)
            };
            var parameter = {
                js: src, 
                js_output_file: out,
                generate_exports: options.export
            };

            var finalOptions = iheritOptions(parameter, config.closure, ex_parameter);
            finalOptions = iheritOptions(finalOptions, options.closure, ex_parameter);

            util.addOptions(args, finalOptions);
            var ls = cp.spawn("java", args);
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

function build(makejson)
{
    makejson = path.resolve(makejson).replace(/\\/g, '/');
    var workspacedir = workspace.rootPath.replace(/\\/g, '/'); 
    function toAbsolute(path)
    {
        if (path.startsWith('/'))
            return workspacedir + path;
        else
            return projectdir + "/" + path;
    }

    var projectdir = makejson.substr(0, makejson.lastIndexOf("/"));
    if (!makejson.startsWith(workspacedir))
    {
        return Promise.reject("workspace: " + workspacedir+"\nproject: " + projectdir+"\nout of workspace");
    }
    try
    {
        var options = JSON.parse(fs.readFileSync(makejson, 'utf8'));
    }
    catch(err)
    {
        return Promise.reject(err.message);
    }

    if (!options.name)
        options.name = projectdir;

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

var exports = {
    help: function(){
        cp.spawnSync("java", ["-jar",closurecompiler,"--help"], {stdio: ['inherit', 'inherit', 'inherit']});
    },
    /**
     * @returns {!Promise} 
     */
    all: function(){
        util.clearLog();
        return glob(workspace.rootPath+"/**/make.json")
        .then((files) => util.cascadingPromise(build, files))
        .then(() => util.log('FINISH ALL'))
        .catch((err) => util.log(err))
    },
    /**
     * @returns {!Promise} 
     */
    make: function(makejs){
        util.clearLog();
        return build(makejs)
        .catch((err) => util.log(err))
    }
};

module.exports = exports;
