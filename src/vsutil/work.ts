
import { Logger } from './log';
import { WorkspaceItem, Workspace } from './ws';
import { Deferred } from '../util/util';

const resolvedPromise:Promise<void> = Promise.resolve();

enum TaskState
{
	WAIT,
	STARTED,
	DONE,
}

export class OnCancel
{
	constructor(private task:TaskImpl<any>, private target?:()=>any)
	{
	}

	public dispose():void
	{
		if (this.target === undefined) return;
		this.task.removeCancelListener(this.target);
		this.target = undefined;
	}
}

export interface Task
{
	readonly cancelled:boolean;
	readonly logger:Logger;
	readonly name:string;
	
	oncancel(oncancel:()=>any):OnCancel;
	checkCanceled():void;
	with<T>(waitWith:Promise<T>):Promise<T>;
}

class TaskImpl<T> implements Task
{
	public next:TaskImpl<any>|null = null;
	public previous:TaskImpl<any>|null = null;
	public cancelled:boolean = false;

	private state:TaskState = TaskState.WAIT;
	private cancelListeners:Array<()=>any> = [];
	private timeout:NodeJS.Timer|undefined;
	public readonly promise:Promise<T>;
	public readonly logger:Logger;
	
	private resolve:(value:T)=>void;
	private reject:(err:any)=>void;

	constructor(
		public readonly scheduler:Scheduler,
		public readonly name:string, 
		public readonly priority:number, 
		public readonly task:(task:Task)=>Promise<T>)
	{
		this.logger = scheduler.logger;
		this.resolve = <any>undefined;
		this.reject = <any>undefined;
		this.promise = new Promise((resolve, reject)=>{
			this.resolve = resolve;
			this.reject = reject;
		});
	}

	public setTimeLimit(timeout:number):void
	{
		if (this.timeout) return;
		if (this.state >= TaskState.STARTED) return;

		this.timeout = setTimeout(()=>{
			const task = this.scheduler.currentTask;
			if (task === null) this.logger.error(Error(`ftp-kr is busy: [null...?] is being proceesed. Cannot run [${this.name}]`));
			else this.logger.error(Error(`ftp-kr is busy: [${task.name}] is being proceesed. Cannot run [${this.name}]`));
			this.cancel();
		}, timeout);
	}

	public async play():Promise<T>
	{
		if (this.state >= TaskState.STARTED)
		{
			throw Error('play must call once');
		}
		this.state = TaskState.STARTED;
		if (this.timeout)
		{
			clearTimeout(this.timeout);
		}
		
		if (this.cancelled) throw 'CANCELLED';

		this.logger.verbose(`[TASK:${this.name}] started`);
		const prom = this.task(this);
		prom.then(v=>{	
			this.logger.verbose(`[TASK:${this.name}] done`);
			this.resolve(v);
		}, err=>{
			if (err === 'CANCELLED')
			{
				this.logger.verbose(`[TASK:${this.name}] cancelled`);
				this.reject('IGNORE');
			}
			else
			{
				if (err instanceof Error)
				{
					err.task = this.name;
				}

				this.logger.verbose(`[TASK:${this.name}] errored`);
				this.reject(err);
			}
		});

		return await this.promise;
	}

	public cancel():void
	{
		if (this.cancelled) return;
		this.cancelled = true;
		if (this.state === TaskState.WAIT)
		{
			this.reject('IGNORE');
		}
		this.fireCancel();
	}
	
	public with<T>(waitWith:Promise<T>):Promise<T>
	{
		if (this.state !== TaskState.STARTED)
		{
			return Promise.reject(Error('Task.with must call in task'));
		}

		if (this.cancelled) return Promise.reject('CANCELLED');
		return new Promise((resolve, reject)=>{
			this.oncancel(()=>reject('CANCELLED'));
			waitWith.then(v=>{
				if (this.cancelled) return;
				this.removeCancelListener(reject);
				resolve(v);
			}, err=>{
				if (this.cancelled) return;
				this.removeCancelListener(reject);
				reject(err);
			});
		});
	}
	
	public oncancel(oncancel:()=>any):OnCancel
	{
		if (this.cancelled)
		{
			oncancel();
			return new OnCancel(this);
		}
		this.cancelListeners.push(oncancel);
		return new OnCancel(this, oncancel);
	}

	public removeCancelListener(oncancel:()=>any):boolean
	{
		const idx = this.cancelListeners.lastIndexOf(oncancel);
		if (idx === -1) return false;
		this.cancelListeners.splice(idx, 1);
		return true;
	}

	public checkCanceled():void
	{
		if (this.cancelled) throw 'CANCELLED';
	}

	private fireCancel():void
	{
		for(const listener of this.cancelListeners)
		{
			listener();
		}
		this.cancelListeners.length = 0;
	}
}

export class Scheduler implements WorkspaceItem
{
	public currentTask:TaskImpl<any>|null = null;
	private nextTask:TaskImpl<any>|null = null;
	private lastTask:TaskImpl<any>|null = null;
	public readonly logger:Logger;

	private promise:Promise<void> = Promise.resolve();

	constructor(arg:Logger|Workspace)
	{
		if (arg instanceof Workspace)
		{
			this.logger = arg.query(Logger);
		}
		else
		{
			this.logger = arg;
		}
	}

	private _addTask(task:TaskImpl<any>):void
	{
		var node = this.lastTask;
		if (node)
		{
			if (task.priority <= node.priority)
			{
				node.next = task;
				task.previous = node;
				this.lastTask = task;
			}
			else
			{
				for (;;)
				{
					const nodenext = node;
					node = node.previous;
					if (!node)
					{
						const next = this.nextTask;
						if (!next) throw Error('Impossible');
						task.next = next;
						next.previous = task;
						this.nextTask = task;
						break;
					}
					if (task.priority <= node.priority)
					{
						nodenext.previous = task;
						task.next = nodenext.next;
						task.previous = node;
						node.next = task;
						break;
					}
				}
			}
		}
		else
		{
			this.nextTask = this.lastTask = task;
		}
	}

	public dispose():void
	{
		this.cancel();
	}

	public cancel():Thenable<void>
	{
		const task = this.currentTask;
		if (!task) return Promise.resolve();

		task.cancel();

		this.logger.message(`[${task.name}]task is cancelled`);

		var next = task.next;
		while (next)
		{
			this.logger.message(`[${next.name}]task is cancelled`);
			next = next.next;
		}

		task.next = null;
		this.nextTask = null;
		this.lastTask = null;
		return task.promise.catch(()=>{});
	}

	public taskMust<T>(name:string, taskfunc:(task:Task)=>Promise<T>, taskFrom?:Task|null, priority?:number):Promise<T>
	{
		if (taskFrom)
		{
			return taskfunc(taskFrom);
		}
		if (priority === undefined) priority = PRIORITY_NORMAL;
		const task = new TaskImpl(this, name, priority, taskfunc);
		this._addTask(task);
		if (!this.currentTask)
		{
			this.logger.verbose(`[SCHEDULAR] start`);
			this.progress();
		}
		return task.promise;
	}
	
	public task<T>(name:string, taskfunc:(task:Task)=>Promise<T>, taskFrom?:Task|null, priority?:number, timeout?:number):Promise<T>
	{
		if (taskFrom)
		{
			return taskfunc(taskFrom);
		}
		if (priority === undefined) priority = PRIORITY_NORMAL;
		if (timeout === undefined) timeout = 2000;
		const task = new TaskImpl(this, name, priority, taskfunc);
		task.setTimeLimit(timeout);
		this._addTask(task);
		if (!this.currentTask)
		{
			this.logger.verbose(`[SCHEDULAR] start`);
			this.progress();
		}
		return task.promise;
	}
	
	private progress():void
	{
		const task = this.nextTask;
		if (!task)
		{
			this.logger.verbose(`[SCHEDULAR] end`);
			this.currentTask = null;
			return;
		}
		this.currentTask = task;

		const next = task.next;
		if (next === null)
		{
			this.nextTask = this.lastTask = null;
		}
		else
		{
			this.nextTask = next;
		}
		const prom = task.play();
		prom.then(()=>this.progress(), ()=>this.progress());
	}
}


export const PRIORITY_HIGH = 2000;
export const PRIORITY_NORMAL = 1000;
export const PRIORITY_IDLE = 0;
