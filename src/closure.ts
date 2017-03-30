
import * as path from "path";
import * as fs from "fs";
import * as cp from 'child_process';
import * as vs from "./vs";
import * as util from "./util";
import glob from "./pglob";
import MakeFile from "./make";
import {config, Config, ClosureConfig} from './config';
import * as vscode from "vscode";
import stripJsonComments = require('strip-json-comments');
import * as nfs from './fs';

const workspace = vscode.workspace;

const ftpkrRoot:string = path.join(path.dirname(__filename),'..').replace(/\\/g, '/');

const closurecompiler:string = ftpkrRoot + "/compiler-latest/closure-compiler-v20170124.jar";

export interface MakeJsonConfig
{
	name:string;
	output:string;
	src:string[];
	export?:boolean;
	makejson:string;
	projectdir:string;
	closure:ClosureConfig;
}

function closure(options:MakeJsonConfig):Promise<string>
{
    var projname = options.name;
    var out = options.output;
    var src = options.src;
    if (src.length == 0)
        return Promise.reject(Error("No source"));
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

                const ex_parameter:ClosureConfig = {
                    js_output_file_filename: out.substr(out.lastIndexOf("/")+1)
                };
                const parameter:ClosureConfig = {
                    js: src, 
                    js_output_file: out,
                    generate_exports: options.export
                };

                var finalOptions = util.merge(parameter, config.closure, ex_parameter);
                finalOptions = util.merge(finalOptions, options.closure, ex_parameter);

                util.addOptions(args, finalOptions);
                const ls = cp.spawn("java", args);
                ls.stdout.on('data', (data:string) => util.log(data));
                ls.stderr.on('data', (data:string) => util.log(data));
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

    return makeFile.make(out).then(v=>v ? 'MODIFIED' : 'LATEST');
}

function include(src:string[]):string[]
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

async function build(makejson:string):Promise<void>
{
    makejson = path.resolve(makejson).replace(/\\/g, '/');
    const workspacedir = workspace.rootPath.replace(/\\/g, '/'); 

    function toAbsolute(path:string):string
    {
        if (path.startsWith('/'))
            return workspacedir + path;
        else
            return projectdir + "/" + path;
    }

    const projectdir = makejson.substr(0, makejson.lastIndexOf("/"));
    if (!makejson.startsWith(workspacedir))
    {
        throw Error("workspace: " + workspacedir+"\nproject: " + projectdir+"\nout of workspace");
    }
    var options = JSON.parse(stripJsonComments(fs.readFileSync(makejson, 'utf8')));

    if (!options.name)
        options.name = projectdir;
    options.projectdir = projectdir;

    options.src = options.src instanceof Array ? options.src : [options.src];
    options.makejson = makejson;
    options.output = toAbsolute(options.output);

    const arg = await glob(options.src.map(toAbsolute));

    if (options.includeReference !== false)
        options.src = include(arg);

	try
	{
		const msg = await closure(options);
		util.log(options.name + ": "+msg);
	}
	catch(err)
	{
		util.log(err);
	}
}

export function help()
{
	cp.spawnSync("java", ["-jar",closurecompiler,"--help"], {stdio: ['inherit', 'inherit', 'inherit']});
}

export async function all():Promise<void>
{
	try
	{
		util.clearLog();
		util.showLog();
		const files = await glob(workspace.rootPath+"/**/make.json");
		await util.cascadingPromise(build, files);
		util.log('FINISH ALL');
	}
	catch(err)
	{
		util.log(err);
	}
}

export function makeJson(makejson:string, input?:string):Promise<void>
{
	if (input) input = path.relative(path.dirname(makejson), input).replace(/\\/g, '/');
	else input = "./script.js";
	const output = (input.endsWith('.js') ? input.substring(0, input.length-3) : input) +'.min.js';
	const makejsonDefault = 
	{
		name: "jsproject",
		src: input, 
		output: output,
		includeReference: true,
		closure: {}
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
}

export function make(makejs:string):Promise<void>
{
	util.clearLog();
	util.showLog();
	return build(makejs);
}
