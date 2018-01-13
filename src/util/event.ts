
export interface Event<T>
{
	(onfunc:(value:T)=>void):void
	
	fire(value?:T):Promise<void>;
	rfire(value?:T):Promise<void>;
}

export function make<T>():Event<T>
{
    const list:((value:T)=>void|Promise<void>)[] = [];
	
    const event = <Event<T>>function event(onfunc:()=>void):void
    {
        list.push(onfunc);
    };
    event.fire = async function(value:T):Promise<void>
    {
        for(const func of list)
            await func(value);
    };
    event.rfire = async function(value:T):Promise<void>
    {
        for(var i = list.length -1 ; i>= 0; i--)
            await list[i](value);
    };
	return event;
}
