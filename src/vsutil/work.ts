
import * as ws from './ws';
import * as log from './log';
import * as error from './error';

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
	readonly logger:log.Logger;
	
	oncancel(oncancel:()=>any):OnCancel;
	checkCanceled():void;
	with<T>(waitWith:Promise<T>):Promise<T>;
}

class TaskImpl<T> implements Task
{
	public next:TaskImpl<any>|null = null;
	public previous:TaskImpl<any>|null = null;
	public cancelled:boolean = false;

	private resolve:()=>void;
	private state:TaskState = TaskState.WAIT;
	private cancelListeners:Array<()=>any> = [];
	private timeout:NodeJS.Timer;
	public promise:Promise<T>;
	public readonly logger:log.Logger;
	private run:()=>void;

	constructor(
		public readonly scheduler:Scheduler,
		public readonly name:string, 
		public readonly priority:number, 
		public readonly task:(task:Task)=>Promise<T>)
	{
		this.logger = scheduler.logger;
		this.promise = new Promise<T>((resolve, reject)=>{
			this.run = ()=>{
				this.logger.verbose(`[TASK:${this.name}] started`);
				const prom = this.task(this);
				prom.then(v=>{	
					this.logger.verbose(`[TASK:${this.name}] done`);
					resolve(v);
				});
				prom.catch(err=>{
					if (err === 'CANCELLED')
					{
						this.logger.verbose(`[TASK:${this.name}] cancelled`);
						reject('IGNORE');
					}
					else
					{
						this.logger.verbose(`[TASK:${this.name}] errored`);
						reject(err);
					}
				});
			};
		});
	}

	public setTimeLimit(timeout:number):void
	{
		if (this.timeout) return;
		if (this.state >= TaskState.STARTED) return;

		this.timeout = setTimeout(()=>{
			this.cancelled = true;

			const task = this.scheduler.currentTask;
			if (task === null) this.logger.error(Error(`ftp-kr is busy: [null...?] is being proceesed. Cannot run [${this.name}]`));
			else this.logger.error(Error(`ftp-kr is busy: [${task.name}] is being proceesed. Cannot run [${this.name}]`));
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
		this.run();
		return await this.promise;
	}

	public cancel():void
	{
		if (this.cancelled) return;
		this.cancelled = true;
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
			});
			waitWith.catch(err=>{
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

export class Scheduler implements ws.WorkspaceItem
{
	public currentTask:TaskImpl<any>|null = null;
	private nextTask:TaskImpl<any>|null = null;
	private lastTask:TaskImpl<any>|null = null;
	public readonly logger:log.Logger;

	private promise:Promise<void> = Promise.resolve();

	constructor(arg:log.Logger|ws.Workspace)
	{
		if (arg instanceof ws.Workspace)
		{
			this.logger = arg.query(log.Logger);
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

	public cancel():void
	{
		const task = this.currentTask;
		if (!task) return;

		task.cancel();

		this.logger.message(`[${task.name}]task is cancelled`);
		this.currentTask = null;

		var next = task.next;
		while (next)
		{
			this.logger.message(`[${next.name}]task is cancelled`);
			next = next.next;
		}

		this.nextTask = null;
		this.lastTask = null;
	}

	public task<T>(name:string, priority:number, taskfunc:(task:Task)=>Promise<T>):Promise<T>
	{
		const task = new TaskImpl(this, name, priority, taskfunc);
		this._addTask(task);
		if (!this.currentTask)
		{
			this.logger.verbose(`[SCHEDULAR] busy`);
			this.progress();
		}
		return task.promise;
	}
	
	public taskWithTimeout<T>(name:string, priority:number, timeout:number, taskfunc:(task:Task)=>Promise<T>):Promise<T>
	{
		const task = new TaskImpl(this, name, priority, taskfunc);
		task.setTimeLimit(timeout);
		this._addTask(task);
		if (!this.currentTask)
		{
			this.logger.verbose(`[SCHEDULAR] busy`);
			this.progress();
		}
		return task.promise;
	}
	
	private progress():void
	{
		const task = this.nextTask;
		if (!task)
		{
			this.logger.verbose(`[SCHEDULAR] idle`);
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
		prom.then(()=>this.progress());
		prom.catch(()=>this.progress());
	}
}


export const HIGH = 2000;
export const NORMAL = 1000;
export const IDLE = 0;
