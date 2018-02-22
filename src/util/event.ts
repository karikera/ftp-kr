import { Deferred } from "./util";


export interface Event<T>
{
	(onfunc:(value:T)=>void|Promise<void>):void
	
	fire(value?:T):Promise<void>;
	remove(onfunc:(value:T)=>void|Promise<void>):boolean;
}

class FiredEvent<T> extends Deferred<void>
{
	constructor(public value:T, public reverse:boolean)
	{
		super();
	}
}


export namespace Event
{
	export function make<T>(name:string, reverse:boolean):Event<T>
	{
		var list:(((value:T)=>void|Promise<void>) | undefined)[] = [];
		var firing = false;
		const fireQueue:FiredEvent<T>[] = [];
		
		const event = <Event<T>>function event(onfunc:(value:T)=>void|Promise<void>):void
		{
			list.push(onfunc);
		};

		async function processFire()
		{
			firing = true;
			await Promise.resolve();

			for (;;)
			{
				const fired = fireQueue.shift();
				if (!fired) break;

				list = list.filter(v=>v);
				if (reverse)
				{
					for(var i = list.length -1 ; i>= 0; i--)
					{
						const func = list[i];
						if (!func) continue;
						const prom = func(fired.value);
						if (prom) await prom.then(fired.resolve, fired.reject);
					}
				}
				else
				{
					for(const func of list)
					{
						if (!func) continue;
						const prom = func(fired.value);
						if (prom) await prom.then(fired.resolve, fired.reject);
					}
				}
			}
			firing = false;
		}

		event.fire = (value:T)=>{
			const fired = new FiredEvent(value, false);
			fireQueue.push(fired);
			if (!firing) processFire();
			return fired;
		};
		event.remove = (onfunc:(value:T)=>void|Promise<void>)=>{
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
