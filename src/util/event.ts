
export interface Event<T>
{
	(onfunc:(value:T)=>void|Promise<void>):void
	
	fire(value?:T):Promise<void>;
	rfire(value?:T):Promise<void>;
	remove(onfunc:(value:T)=>void|Promise<void>):boolean;
}

export namespace Event
{
	export function make<T>():Event<T>
	{
		var list:(((value:T)=>void|Promise<void>) | undefined)[] = [];
		var firing = false;
		
		const event = <Event<T>>function event(onfunc:(value:T)=>void|Promise<void>):void
		{
			list.push(onfunc);
		};

		event.fire = async function(value:T):Promise<void>
		{
			if (firing) throw Error('Event is already firing');
			firing = true;
			list = list.filter(v=>v);
			await Promise.resolve();
			for(const func of list)
			{
				if (!func) continue;
				await func(value);
			}
			firing = false;
		};
		event.rfire = async function(value:T):Promise<void>
		{
			if (firing) throw Error('Event is already firing');
			firing = true;list = list.filter(v=>v);
			await Promise.resolve();
			for(var i = list.length -1 ; i>= 0; i--)
			{
				const func = list[i];
				if (!func) continue;
				await func(value);
			}
			firing = false;
		};
		event.remove = function(onfunc:(value:T)=>void|Promise<void>):boolean
		{
			const idx = list.indexOf(onfunc);
			if (idx !== -1)
			{
				list[idx] = undefined;
				return true;
			}
			return false;
		};
		return event;
	}
}
