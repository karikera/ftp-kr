
import * as path from "path";
import * as fs from "fs";
import * as cp from 'child_process';
import * as vs from "./vs";
import * as util from "./util";
import glob from "./pglob";
import MakeFile from "./make";
import {config, Config, ClosureConfig} from './config';
import * as vscode from "vscode";
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
	closure?:ClosureConfig;
	includeReference?:boolean;
}

function closure(options:MakeJsonConfig):Promise<string>
{
    var projname = options.name;
    var out = options.output;
    var src = options.src;
    if (src.length == 0)
        return Promise.reject(Error("No source"));
    options.export = !!options.export;
    
    const makeFile = new MakeFile;

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
                        resolve(false);
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

    return makeFile.make(out).then(v=>v ? 'COMPILED' : 'LATEST');
}

async function build(makejson:string):Promise<void>
{
    function toAbsolute(path:string):string
    {
        if (path.startsWith('/'))
            return nfs.workspace + path;
        else
            return projectdir + "/" + path;
    }

	makejson = nfs.workspace + makejson;
	
    const projectdir = makejson.substr(0, makejson.lastIndexOf("/"));
    var options = util.parseJson(fs.readFileSync(makejson, 'utf8'));

    if (!options.name)
        options.name = projectdir;
    options.projectdir = projectdir;

    options.src = options.src instanceof Array ? options.src : [options.src];
    options.makejson = makejson;
    options.output = toAbsolute(options.output);

    const arg = await glob(options.src.map(toAbsolute));

	if (options.includeReference !== false)
	{
		const includer = new vs.Includer;
		includer.include(arg);
		if (includer.errors.length !== 0)
		{
			for(var err of includer.errors)
			{
				util.log(path.resolve(err[0])+":"+err[1]+"\n\t"+err[2]);
			}
			return;
		}
		options.src = includer.list;
	}

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
		for (const file of files)
		{
			await build(nfs.worklize(file));
		}
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

	makejson = nfs.worklize(makejson);
	return nfs.initJson(makejson, makejsonDefault)
		.then(() => util.open(makejson)).then(()=>{});
}

export function make(makejs:string):Promise<void>
{
	util.clearLog();
	util.showLog();
	return build(makejs);
}
