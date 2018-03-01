
import { File } from 'krfile';
import { printMappedError } from '../util/sm';


function mergeType(obj:any, other:any):void
{
	if (obj.properties)
	{
		if (other.properties)
		{
			for (const p in other.properties)
			{
				const ori = obj.properties[p];
				if (ori) mergeType(ori, other.properties[p]);
				else obj.properties[p] = other.properties[p];
			}
		}
	}
}

async function readType(file:File, obj:any):Promise<any>
{
	if (obj.$ref)
	{
		return await readSchema(file.sibling(obj.$ref));
	}
	if (obj.allOf)
	{
		for (var i=0;i<obj.allOf.length;i++)
		{
			const c = obj.allOf[i] = await readType(file, obj.allOf[i]);
			mergeType(obj, c);
		}
	}
	return obj;
}

async function readSchema(file:File):Promise<any>
{
	const obj = await file.json();
	await readType(file, obj);
	return obj;
}


class MdWriter
{
	private md:string = '';
	private objects:{[key:string]:string} = {};
	private address:string = '';
	private itemName:string = '';

	constructor()
	{
	}

	finalize():string
	{
		var md = '';
		for (const name in this.objects)
		{
			md += '## '+(name || 'ftp-kr.json')+'\n';
			md += this.objects[name];
		}
		return md;
	}

	object(obj:any):void
	{
		const olditemname = this.itemName;
		const oldaddress = this.address;
		const oldmd = this.md;
		const prefix = oldaddress ? oldaddress + '.': '';
		for (var p in obj.properties)
		{
			this.itemName = p;
			this.address = prefix + p;
			this.type(obj.properties[p]);
		}
		this.itemName = olditemname;
		this.address = oldaddress;
		this.objects[this.address] = this.md;
		this.md = oldmd;
	}

	type(obj:any):void
	{
		this.md += `* **${this.address}** `;
		const enumlist = obj.enum;
		if (enumlist && enumlist.length <= 5)
		{
			this.md += `(enum: ${enumlist.join(', ')})`;
		}
		else if (obj.items)
		{
			this.md += `(${obj.items.type}[])`;
		}
		else if (obj.type) this.md += `(${obj.type})`;
		if (obj.deprecationMessage)
		{
			this.md += ' (**DEPRECATED: '+obj.deprecationMessage+'**)';
		}
		
		var desc = obj.description || '';
		if (obj.properties)
		{
			this.object(obj);
			desc += ` [see properties](${this.address.replace(/\./g, '')})`;
		}
		if (desc) this.md += ' - '+desc;
		this.md += '\n';
	}
}

async function main():Promise<void>
{
	const arg = process.argv[2];
	if (!arg) return;
	const file = new File(arg);
	const obj = await readSchema(file);
	const writer = new MdWriter;
	writer.object(obj);
	await file.reext('md').create(writer.finalize());
}

main().catch(err=>printMappedError(err));
