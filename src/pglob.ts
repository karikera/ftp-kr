
import glob_inner = require("glob");
import * as util from "./util";

function glob(pattern:string):Promise<string[]>
{
    pattern = pattern.replace(/\\/g, "/");
    return new Promise<string[]>((resolve, reject)=>{
        glob_inner(pattern, (err, files)=>{ 
            if (err) reject(err);
            else resolve(files);
        });
    });
}

function globAll(files:string[]):Promise<string[]>
{
    return util.cascadingPromise(glob, files)
    .then((fileses) => (<string[]>[]).concat(...fileses));
}

export default function(pattern:string|string[]):Promise<string[]>
{
    if (pattern instanceof Array)
        return globAll(pattern);
    return glob(pattern);
};
