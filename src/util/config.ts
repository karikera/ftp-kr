
import * as util from './util';

export class ConfigContainer
{
	protected readonly settedProperties:Set<string> = new Set;
	
	protected clearConfig()
	{
		for (const name of this.settedProperties)
		{
			delete this[name];
		}
		this.settedProperties.clear();
	}
	
	protected appendConfig(config:Object):void
	{
		for (const p in config)
		{
			this.setProperty(p, config[p]);
		}
	}

	protected setProperty(name:string, value:any):void
	{
		this[name] = util.clone(value);
		this.settedProperties.add(name);
	}
	
}
