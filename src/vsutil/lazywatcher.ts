import { FileSystemWatcher, Uri, workspace } from 'vscode';
import { Event } from '../util/event';

enum UpdateState {
	Change,
	Create,
	Delete,
	NoChange,
	Disposed,
}

class DelayableTimeout {
	private timeout: NodeJS.Timeout | null;
	private resolve: () => void;
	private readonly promise: Promise<void>;
	constructor(timeout: number) {
		this.resolve = null as any;
		this.promise = new Promise((resolve) => {
			this.resolve = () => {
				this.timeout = null;
				resolve();
			};
		});
		this.timeout = setTimeout(this.resolve, timeout);
	}

	wait(): Promise<void> {
		return this.promise;
	}

	delay(timeout: number): void {
		if (this.timeout !== null) clearTimeout(this.timeout);
		this.timeout = setTimeout(this.resolve, timeout);
	}

	isDone(): boolean {
		return this.timeout === null;
	}

	done(): void {
		if (this.timeout === null) return;
		clearTimeout(this.timeout);
		this.timeout = null;
		this.resolve();
	}
}

class WatchItem {
	public readonly timeout: DelayableTimeout;

	constructor(
		public readonly watcher: LazyWatcher,
		public readonly uri: Uri,
		public readonly uristr: string,
		public state: UpdateState
	) {
		this.timeout = new DelayableTimeout(watcher.waitingDuration);
		this._fire();
	}

	private async _fire(): Promise<void> {
		do {
			await this.timeout.wait();
			if (this.state === UpdateState.Disposed) return;
			if (this.state === UpdateState.NoChange) break;
			const ev = this.watcher.events[this.state];
			this.state = UpdateState.NoChange;
			await ev.fire(this.uri);
		} while (this.state !== UpdateState.NoChange);
		this.watcher.items.delete(this.uristr);
	}

	update(state: UpdateState): void {
		switch (this.state) {
			case UpdateState.Change:
				switch (state) {
					case UpdateState.Delete:
						this.state = UpdateState.Delete;
						break;
				}
				break;
			case UpdateState.Create:
				switch (state) {
					case UpdateState.Delete:
						this.state = UpdateState.NoChange;
						this.timeout.done();
						return;
				}
				break;
			case UpdateState.Delete:
				switch (state) {
					case UpdateState.Create:
						this.state = UpdateState.Change;
						break;
					case UpdateState.Change:
						this.state = UpdateState.Create;
						break;
				}
				break;
			case UpdateState.NoChange:
				this.state = state;
				return;
		}
		this.timeout.delay(this.watcher.waitingDuration);
	}

	dispose(): void {
		if (this.state === UpdateState.Disposed) return;
		this.state = UpdateState.Disposed;
		this.timeout.done();
	}
}

export class LazyWatcher {
	private readonly watcher: FileSystemWatcher;

	public readonly items = new Map<string, WatchItem>();

	public readonly onDidChange = Event.make<Uri>(false);
	public readonly onDidCreate = Event.make<Uri>(false);
	public readonly onDidDelete = Event.make<Uri>(false);

	public readonly events = [
		this.onDidChange,
		this.onDidCreate,
		this.onDidDelete,
	];

	private disposed = false;

	private onEvent(state: UpdateState, uri: Uri): void {
		const uristr = uri.toString();
		const item = this.items.get(uristr);
		if (item == null) {
			const nitem = new WatchItem(this, uri, uristr, state);
			this.items.set(uristr, nitem);
		} else {
			item.update(state);
		}
	}

	constructor(watcherPath: string, public waitingDuration: number = 500) {
		this.watcher = workspace.createFileSystemWatcher(watcherPath);

		this.watcher.onDidChange((uri) => {
			this.onEvent(UpdateState.Change, uri);
		});
		this.watcher.onDidCreate((uri) => {
			this.onEvent(UpdateState.Create, uri);
		});
		this.watcher.onDidDelete((uri) => {
			this.onEvent(UpdateState.Delete, uri);
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.watcher.dispose();
		for (const item of this.items.values()) {
			item.dispose();
		}
	}
}
