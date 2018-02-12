
import * as util from './util';

export class ConfigContainer<T>
{
	protected readonly properties:Set<keyof T>;
	constructor(properties:(keyof T)[])
	{
		this.properties = new Set(properties);
		Object.freeze(this.properties);
	}

	protected isProperty(name:string):name is (keyof T)
	{
		return this.properties.has(<keyof T>name);
	}

	
	protected clearConfig()
	{
		for (const name of this.properties)
		{
			delete (<any>this)[name];
		}
	}
	
	protected appendConfig(config:T):void
	{
		for (const p in config)
		{
			if (!this.isProperty(p)) continue;
			(<any>this)[p] = config[p];
		}
	}
	
}
