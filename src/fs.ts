
import * as fs from "fs";
import * as path from 'path';
import stripJsonComments = require('strip-json-comments');

function callbackToPromise<T>(call:(callback:(err:Error, value?:T)=>void)=>void):Promise<T>
{
    return new Promise<T>((resolve, reject)=>{
        call((err, data)=>{
            if (err) reject(err);
            else resolve(data);
        });
    });
}

function mkdirParent(dirPath:string, callback:(err?:Error)=>void):void
{
    return fs.mkdir(dirPath, error=>{
        if (error)
        {
            switch(error.code)
            {
			case 'EEXIST':
				callback();
				return;
            case 'ENOENT':
                return mkdirParent(path.dirname(dirPath), () => fs.mkdir(dirPath, callback));
            }
        }
        callback && callback(error);
    });
};

export type Stats = fs.Stats;
export var workspace = '';

export function setWorkspace(path:string):void
{
	workspace = path;
}

export function worklize(localpath:string):string
{
	const fullpath = path.resolve(localpath).replace(/\\/g, '/');
	if (!fullpath.startsWith(workspace))
		throw new Error(localpath+" not in workspace");
	const workpath = fullpath.substr(workspace.length);
	if (workpath !== '' && workpath.charAt(0) !== '/')
		throw new Error(localpath+" not in workspace");
	return workpath;
}

export function list(path:string):Promise<string[]>
{
	if (path !== "" && !path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
	return callbackToPromise((callback)=>fs.readdir(workspace + path, callback));
}

export function stat(path:string):Promise<fs.Stats>
{
	if (path !== "" && !path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
	return callbackToPromise((callback)=>fs.stat(workspace + path, callback));
}

export function mkdir(path:string):Promise<void>
{
	if (!path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
	return new Promise<void>((resolve, reject)=>{
		fs.mkdir(workspace + path, (err)=>{
			if (err)
			{
				switch (err.code)
				{
				case 'EEXIST': resolve(); return;
				default: reject(err); return;
				}
			}
			else resolve();
		});
	});
}

export function mkdirp(path:string):Promise<void>
{
	if (!path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
	return callbackToPromise<void>(callback=>mkdirParent(workspace + path, callback));
}

export function lstat(path:string):Promise<fs.Stats>
{
	if (path !== "" && !path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
	return callbackToPromise((callback)=>fs.lstat(workspace + path, callback));
}

export function open(path:string):Promise<string>
{
	if (!path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
	return callbackToPromise((callback)=>fs.readFile(workspace + path, "utf-8", callback));
}

export function exists(path:string):Promise<boolean>
{
	if (!path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
	return new Promise((resolve) => fs.exists(workspace + path, resolve));
}

export function json(path:string):Promise<any>
{
	return open(path).then((data) => JSON.parse(stripJsonComments(data)));
}

export function create(filepath:string, data:string):Promise<void>
{
	return mkdirp(path.dirname(filepath))
	.then(() => callbackToPromise<void>((callback)=>fs.writeFile(workspace + filepath, data, "utf-8", callback)));
}

export function createSync(path:string, data:string)
{
	if (!path.startsWith("/")) throw new Error("Path must starts with slash: "+path);
	return fs.writeFileSync(workspace + path, data, "utf-8");
}

export function unlink(path:string):Promise<void>
{
	if (!path.startsWith("/")) return Promise.reject(new Error("Path must starts with slash: "+path));
	return callbackToPromise<void>((callback)=>fs.unlink(workspace + path, callback));
}

export function initJson<T>(filepath:string, defaultValue:Object):Promise<any>
{
	return json(filepath).then((data)=>{
		var changed = false;
		for (var p in defaultValue)
		{
			if (p in data) continue;
			data[p] = defaultValue[p];
			changed = true;
		}
		if (!changed) return data;
		return create(filepath, JSON.stringify(data, null, 4))
		.then(()=> data);
	})
	.catch(()=>{
		return create(filepath, JSON.stringify(defaultValue, null, 4))
		.then(() => Object.create(defaultValue));
	});
}

export function isDirectory(path:string):Promise<boolean>
{
	return stat(path).then(stat=>stat.isDirectory());
}
