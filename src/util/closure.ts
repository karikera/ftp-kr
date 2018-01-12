import * as path from 'path';
import * as ofs from 'fs';
import * as cp from 'child_process';

import * as make from './make';
import * as fs from './fs';
import * as work from './work';
import * as util from './util';
import * as vs from './vs';

const ftpkrRoot:string = path.join(path.dirname(__filename),'../..').replace(/\\/g, '/');

const closurecompiler:string = ftpkrRoot + "/compiler-latest/closure-compiler-v20170806.jar";

export interface Config
{
	js_output_file_filename?:string;
	js?:string[]|string;
	js_output_file?:string;
	generate_exports?:boolean;
	create_source_map?:string;
	output_wrapper?:string;
}

export interface MakeJsonConfig
{
	name:string;
	output:string;
	src:string[];
	export?:boolean;
	makejson:string;
	projectdir:string;
	closure?:Config;
	includeReference?:boolean;
}

export function closure(task:work.Task, options:MakeJsonConfig, config:Config):Promise<string>
{
    var projname = options.name;
    var out = options.output;
    var src = options.src;
    if (src.length == 0)
        return Promise.reject(Error("No source"));
    options.export = !!options.export;
    
    const makeFile = new make.MakeFile;

    makeFile.on(out, src.concat([options.makejson]), ()=>{
        return new Promise((resolve, reject)=> {
            const curdir = process.cwd();
            try
            {
                process.chdir(options.projectdir);
                task.logger.message(projname + ": BUILD");
                const args = ['-jar', closurecompiler];

                const ex_parameter:Config = {
                    js_output_file_filename: out.substr(out.lastIndexOf("/")+1)
                };
                const parameter:Config = {
                    js: src, 
                    js_output_file: out,
                    generate_exports: options.export
                };

                var finalOptions = util.merge(parameter, config, ex_parameter);
                finalOptions = util.merge(finalOptions, options.closure, ex_parameter);

                util.addOptions(args, finalOptions);
                const java = cp.spawn("java", args);
                java.stdout.on('data', (data:string) => task.logger.message(data));
				java.stderr.on('data', (data:string) => task.logger.message(data));
				const oncancel = task.oncancel(()=>java.kill());
                java.on('close', (code, signal) => {
					if (signal === 'SIGTERM')
					{
						oncancel.dispose();
						reject(work.CANCELLED);
						return;
					}
                    if (code === 0)
                    {
                        resolve(make.State.COMPLETE);
                    }
                    else
                    {
                        resolve(make.State.ERROR);
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

    return makeFile.make(out).then(v=>make.State[v]);
}

export async function build(task:work.Task, makejson:fs.Path, config:Config):Promise<void>
{
	const projectdir = makejson.parent();
	const workspace = makejson.workspace();
    function toAbsolute(p:string):fs.Path
    {
		var str:fs.Path;
        if (p.startsWith('/'))
            return workspace.child(p);
        else
			return projectdir.child(p);
    }

	var options = await makejson.json();
	if (!options)
	{
		const err:fs.FileError = Error('invalid make.json');
		err.path = makejson;
		throw err;
	}
    if (!options.name)
        options.name = projectdir;
    options.projectdir = projectdir;

    options.src = options.src instanceof Array ? options.src : [options.src];
    options.makejson = makejson;
    options.output = toAbsolute(options.output);

    const arg = await fs.Path.glob(options.src.map(toAbsolute));

	if (options.includeReference !== false)
	{
		const includer = new vs.Includer;
		await includer.include(arg);
		if (includer.errors.length !== 0)
		{
			for(var err of includer.errors)
			{
				task.logger.message(path.resolve(err[0])+":"+err[1]+"\n\t"+err[2]);
			}
			return;
		}
		options.src = includer.list;
	}

	const msg = await closure(task, options, config);
	task.logger.message(options.name + ": "+msg);
}

export function help():Promise<string>
{
	return new Promise<string>(resolve=>{
		const help = cp.spawn("java", ["-jar", closurecompiler, "--help"]);
		var str = '';
		help.stderr.on('data', (data:string) => { str += data; });
		help.stdout.on('data', (data:string) => { str += data; });
		help.on('close', (code, signal)=>resolve(str));
	});
}
