
import glob_inner = require("glob");

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

async function globAll(files:string[]):Promise<string[]>
{
	const res:string[] = [];
	for (const file of files)
	{
		res.push(... await glob(file));
	}
    return res;
}

export default function(pattern:string|string[]):Promise<string[]>
{
    if (pattern instanceof Array)
        return globAll(pattern);
    return glob(pattern);
};
