import * as log from './log';

const resolvedPromise:Promise<void> = Promise.resolve();

export const CANCELLED = Symbol('TASK_CANCELLED');

enum TaskState
{
	WAIT,
	STARTED,
	DONE,
}

export class OnCancel
{
	constructor(private task:TaskImpl, private target?:()=>any)
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
	
	oncancel(oncancel:()=>any):OnCancel;
	checkCanceled():void;
	with<T>(waitWith:Promise<T>):Promise<T>;
}

var onErrorCallback:(callback:any)=>void = ()=>{};

class TaskImpl implements Task
{
	public next:TaskImpl|null = null;
	public cancelled:boolean = false;

	private resolve:()=>void;
	private state:TaskState = TaskState.WAIT;
	private cancelListeners:Array<()=>any> = [];
	private timeout:NodeJS.Timer;
	public promise:Promise<void>;

	constructor(private scheduler:Scheduler,public name:string, public task:(task:Task)=>any)
	{
		this.promise = new Promise<void>(resolve=>this.resolve = resolve);
	}

	public setTimeLimit(timeout:number):void
	{
		if (this.timeout) return;
		if (this.state >= TaskState.STARTED) return;

		this.timeout = setTimeout(()=>{
			this.cancelled = true;

			const task = this.scheduler.currentTask;
			if (task === null) onErrorCallback(Error(`ftp-kr is busy: [null...?] is being proceesed. Cannot run [${this.name}]`));
			else onErrorCallback(Error(`ftp-kr is busy: [${task.name}] is being proceesed. Cannot run [${this.name}]`));
		}, timeout);
	}

	public async play():Promise<void>
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
		
		if (this.cancelled) return;

		log.verbose(`[TASK:${this.name}] started`);
		try
		{
			await this.task(this);
		}
		catch(e)
		{
			if (e === CANCELLED)
			{
				log.verbose(`[TASK:${this.name}] cancelled`);
				return;
			}
			onErrorCallback(e);
		}
		log.verbose(`[TASK:${this.name}] done`);
		this.resolve();
		return this.promise;
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

		if (this.cancelled) return Promise.reject(CANCELLED);
		return new Promise((resolve, reject)=>{
			this.oncancel(reject);
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
		if (this.cancelled) throw CANCELLED;
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

class Scheduler
{
	public currentTask:TaskImpl|null = null;
	private nextTask:TaskImpl|null = null;
	private lastTask:TaskImpl|null = null;

	private promise:Promise<void> = Promise.resolve();

	constructor(private name:string)
	{
	}

	public cancel():void
	{
		const task = this.currentTask;
		if (!task) return;

		task.cancel();
		log.message(`[${this.name}/${task.name}]task is cancelled`);
		this.currentTask = null;

		var next = task.next;
		while (next)
		{
			log.message(`[${this.name}/${next.name}]task is cancelled`);
			next = next.next;
		}

		this.nextTask = null;
		this.lastTask = null;
	}

	public task(name:string, taskfunc:(task:Task)=>any):Thenable<void>
	{
		const task = new TaskImpl(this, name, taskfunc);
		const last = this.lastTask;
		if (last)
		{
			last.next = task;
			this.lastTask = task;
		}
		else
		{
			this.nextTask = this.lastTask = task;
		}
		if (!this.currentTask)
		{
			log.verbose(`[SCHEDULAR:${this.name}] busy`);
			this.progress();
		}
		return task.promise;
	}
	
	public taskWithTimeout(name:string, timeout:number, taskfunc:(task:Task)=>any):Thenable<void>
	{
		const task = new TaskImpl(this, name, taskfunc);
		task.setTimeLimit(timeout);
		const last = this.lastTask;
		if (last)
		{
			last.next = task;
			this.lastTask = task;
		}
		else
		{
			this.nextTask = this.lastTask = task;
		}
		if (!this.currentTask)
		{
			log.verbose(`[SCHEDULAR:${this.name}] busy`);
			this.progress();
		}
		return task.promise;
	}
	
	private progress():void
	{
		const task = this.nextTask;
		if (!task)
		{
			log.verbose(`[SCHEDULAR:${this.name}] idle`);
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
		task.play().then(()=>this.progress());
	}
}

export function onError(callback:(message:any)=>void):void
{
	onErrorCallback = callback;
}

export const compile = new Scheduler('compile');
export const ftp = new Scheduler('ftp');
export const load = new Scheduler('load');

