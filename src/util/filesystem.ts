import { File } from 'krfile';

import { Event } from './event';
import { FileInfo, FileType } from './fileinfo';
import { ftp_path } from './ftp_path';
import minimatch = require('minimatch');
import { Disposable, FileChangeType, Uri } from 'vscode';

interface FileNameSet {
	dir: string;
	name: string;
}

interface SerializedState {
	[key: string]: SerializedState | string | number | boolean | undefined;
	type?: string;
	size?: number;
	lmtime?: number;
	modified?: boolean;
}

interface SerializedStateRoot extends SerializedState {
	$version?: number;
}

export function splitFileName(path: string): FileNameSet {
	const pathidx = path.lastIndexOf('/');
	const dir = pathidx === -1 ? '' : path.substr(0, pathidx);
	return {
		dir: dir,
		name: path.substr(pathidx + 1),
	};
}

export abstract class VFSState extends FileInfo {
	public type: FileType = '';
	public size = 0;
	public date = 0;
	public lmtime = 0;
	public lmtimeWithThreshold = 0;
	public remoteModified = false;

	public contentCached = false; // If it is set, fire refresh in next modification
	public treeCached = false; // If it is set, fire refresh in next modification

	public readonly fs: VFSServerList;
	public readonly server: VFSServer | undefined;

	constructor(
		public readonly parent: VFSDirectory | undefined,
		public readonly name: string
	) {
		super();

		this.fs = parent ? parent.fs : <any>this;
		if (!(this.fs instanceof VFSServerList)) {
			throw Error('Invalid parameter');
		}
		let server: VFSServer | undefined;
		if (this instanceof VFSServer) {
			server = this;
		} else if (parent !== undefined) {
			if (parent instanceof VFSServer) {
				server = parent;
			} else {
				server = parent.server;
			}
		}
		this.server = server;
	}

	public getPath(): string {
		const list: string[] = [];
		let file: VFSState | undefined = this;
		while (file && file !== this.server) {
			list.push(file.name);
			file = file.parent;
		}
		list.push('');
		if (list.length === 1) return '/';
		return list.reverse().join('/');
	}

	public getUri(): Uri {
		const server = this.server;
		if (server === undefined)
			throw Error(`Server not determined, ${this.name}`);
		const list: string[] = [];
		let parent: VFSState | undefined = this;
		while (parent && parent !== server) {
			list.push(parent.name);
			parent = parent.parent;
		}
		list.push(server.hostUri);
		return Uri.parse(list.reverse().join('/'));
	}

	public abstract serialize(): SerializedState;
	public abstract deserialize(data: SerializedState): void;
	public setByInfo(file: FileInfo): void {
		this.size = file.size;
		this.date = file.date;
	}

	private readonly recursiveWatcher: VFSWatcher[] = [];
	private readonly directWatcher: VFSWatcher[] = [];

	public watch(
		cb: (
			to: VFSState,
			from: VFSState | undefined,
			type: FileChangeType
		) => void,
		opts: { excludes?: string[]; recursive?: boolean }
	): VFSWatcher {
		const target = opts.recursive ? this.recursiveWatcher : this.directWatcher;
		const watcher = new VFSWatcher(cb, opts.excludes, () => {
			const idx = target.indexOf(watcher);
			if (idx === -1) return;
			target.splice(idx, 1);
		});
		target.push(watcher);
		return watcher;
	}
	public fireWatcher(from: VFSState | undefined, type: FileChangeType): void {
		const filePath = this.getPath();
		for (const watcher of this.directWatcher) {
			watcher.fire(this, from, filePath, type);
		}

		let parent: VFSState | undefined = this;
		for (;;) {
			for (const watcher of parent.recursiveWatcher) {
				watcher.fire(this, from, filePath, type);
			}
			parent = parent.parent;
			if (parent === undefined) break;
		}
		this.refreshContent();
	}
	public refreshContent(): Promise<void> {
		if (!this.contentCached) return Promise.resolve();
		this.contentCached = false;
		return this.fs.onRefreshContent.fire(this);
	}
}

function isReadOnlyFile(name: string): boolean {
	return name === '' || name === '.' || name === '..';
}

export class VFSWatcher extends Disposable {
	constructor(
		private readonly callback: (
			to: VFSState,
			from: VFSState | undefined,
			type: FileChangeType
		) => void,
		private readonly excludes: string[] | undefined,
		dispose: () => void
	) {
		super(dispose);
	}

	private isExcluded(filePath: string): boolean {
		if (this.excludes === undefined) return false;
		for (const pattern of this.excludes) {
			if (minimatch(filePath, pattern)) return true;
		}
		return false;
	}

	fire(
		to: VFSState,
		from: VFSState | undefined,
		filePath: string,
		type: FileChangeType
	): void {
		if (this.isExcluded(filePath)) return;
		this.callback(to, from, type);
	}
}

export class VFSDirectory extends VFSState {
	private files = new Map<string, VFSState>();

	constructor(parent: VFSDirectory | undefined, name: string) {
		super(parent, name);

		this.type = 'd';

		this.files.set('', this);
		this.files.set('.', this);
		if (this.parent) this.files.set('..', this.parent);
	}

	public async refreshContent(): Promise<void> {
		for (const child of this.children()) {
			await child.refreshContent();
		}
	}

	public serialize(): SerializedState {
		const files: SerializedState = {};
		for (const file of this.children()) {
			files[file.name] = file.serialize();
		}
		return files;
	}

	public deserializeTo(filename: string, data: SerializedState): void {
		let file: VFSState;
		switch (data.type) {
			case '-':
				file = new VFSFile(this, filename);
				break;
			case 'l':
				file = new VFSSymLink(this, filename);
				break;
			default:
				file = new VFSDirectory(this, filename);
				break;
		}
		file.deserialize(data);
		this.setItem(filename, file);
	}

	public deserialize(data: SerializedState): void {
		if (typeof data !== 'object') return;
		for (const filename in data) {
			const sfile = data[filename];
			if (!sfile) continue;
			if (typeof sfile !== 'object') continue;
			this.deserializeTo(filename, sfile);
		}
	}

	public setByInfos(remoteList: FileInfo[]): void {
		const nfiles = new Map<string, VFSState>();
		nfiles.set('', this);
		nfiles.set('.', this);
		if (this.parent) nfiles.set('..', this.parent);

		let childrenChanged = false;

		for (const remoteFile of remoteList) {
			_nofile: switch (remoteFile.name) {
				case undefined:
					break;
				case '..':
					break;
				case '.':
					this.setByInfo(remoteFile);
					break;
				default:
					let makingFile = this.files.get(remoteFile.name);
					const cacheFile = makingFile;
					if (!makingFile || makingFile.type !== remoteFile.type) {
						switch (remoteFile.type) {
							case 'd':
								makingFile = new VFSDirectory(this, remoteFile.name);
								break;
							case '-':
								makingFile = new VFSFile(this, remoteFile.name);
								break;
							case 'l':
								makingFile = new VFSSymLink(this, remoteFile.name);
								break;
							default:
								break _nofile;
						}
					}
					let modified = false;
					if (cacheFile) {
						if (makingFile !== cacheFile) {
							childrenChanged = true;
							modified = true;
						} else if (
							cacheFile.type === '-' &&
							remoteFile.size !== cacheFile.size
						) {
							modified = true;
						}
					}
					nfiles.set(remoteFile.name, makingFile);
					makingFile.setByInfo(remoteFile);
					if (modified) {
						makingFile.remoteModified = true;
						makingFile.fireWatcher(cacheFile, FileChangeType.Changed);
					}
					break;
			}
		}

		this.files = nfiles;

		if (childrenChanged && this.treeCached) {
			this.treeCached = false;
			this.fs.onRefreshTree.fire(this);
		}
	}

	public putBySerialized(path: string, data: SerializedState): void {
		const fn = splitFileName(path);
		const dir = <VFSDirectory>this.getDirectoryFromPath(fn.dir, true);
		dir.deserializeTo(fn.name, data);
	}

	public *children(): Iterable<VFSState> {
		for (const [name, file] of this.files) {
			switch (name) {
				case '':
				case '.':
				case '..':
					continue;
			}
			yield file;
		}
	}

	public item(name: string): VFSState | undefined {
		return this.files.get(name);
	}

	public get fileCount(): number {
		return this.files.size;
	}

	public setItem(name: string, item: VFSState): void {
		if (isReadOnlyFile(name))
			throw TypeError(
				`VFSDirectory.setItem, invalid path ${this.getPath()}/${name}`
			);

		const old = this.files.get(name);
		this.files.set(name, item);
		item.fireWatcher(
			old,
			old === undefined ? FileChangeType.Created : FileChangeType.Changed
		);

		if (this.treeCached) {
			if (!old || item.type === old.type) {
				this.treeCached = false;
				this.fs.onRefreshTree.fire(this);
			}
		}
	}

	public deleteItem(name: string): boolean {
		if (isReadOnlyFile(name))
			throw TypeError(
				`VFSDirectory.deleteItem, invalid path ${this.getPath()}/${name}`
			);

		const old = this.files.get(name);
		if (!old) return false;
		this.files.delete(name);
		old.fireWatcher(old, FileChangeType.Deleted);
		if (this.treeCached) {
			this.treeCached = false;
			this.fs.onRefreshTree.fire(this);
		}
		return true;
	}

	public getDirectoryFromPath(
		path: string,
		make?: boolean
	): VFSDirectory | undefined {
		if (path.startsWith('/')) path = path.substr(1);
		const dirs = path.split('/');
		let dir: VFSDirectory = this;
		for (const cd of dirs) {
			const ndir = dir.files.get(cd);
			if (ndir) {
				if (ndir instanceof VFSDirectory) {
					dir = ndir;
					continue;
				}
			}
			if (!make) return undefined;
			const maked = new VFSDirectory(dir, cd);
			dir.setItem(cd, maked);
			dir = maked;
		}
		return dir;
	}

	public getFromPath(ftppath: string): VFSState | undefined {
		const parent = ftp_path.dirname(ftppath);
		const dir = this.getDirectoryFromPath(parent);
		if (!dir) return undefined;
		return dir.item(ftp_path.basename(ftppath));
	}

	private _mkdir(name: string): VFSDirectory {
		const ndir = this.files.get(name);
		if (ndir) {
			if (ndir instanceof VFSDirectory) {
				return ndir;
			}
		}
		const maked = new VFSDirectory(this, name);
		this.setItem(name, maked);
		return maked;
	}

	private _setFromItem(name: string, item: VFSState): VFSState {
		let state: VFSState;
		if (item instanceof VFSDirectory) {
			const dir = this._mkdir(name);
			for (const child of item.children()) {
				dir._setFromItem(child.name, child);
			}
			state = dir;
		} else if (item instanceof VFSFile) {
			state = new VFSFile(this, name);
			state.remoteModified = item.remoteModified;
			state.size = item.size;
			this.setItem(name, state);
		} else if (item instanceof VFSSymLink) {
			state = new VFSSymLink(this, name);
			state.link = item.link;
			this.setItem(name, state);
		} else {
			throw TypeError(`Unexpected param type: ${item.constructor.name}`);
		}
		state.date = item.date;
		state.lmtime = item.lmtime;
		state.lmtimeWithThreshold = item.lmtimeWithThreshold;
		state.treeCached = item.treeCached;
		return state;
	}

	public setFromItem(path: string, item: VFSState): VFSState {
		const fn = splitFileName(path);
		const dir = this.getDirectoryFromPath(fn.dir, true)!;
		return dir._setFromItem(fn.name, item);
	}

	public createFromPath(path: string): VFSFile {
		const fn = splitFileName(path);
		const dir = this.getDirectoryFromPath(fn.dir, true)!;
		const file = new VFSFile(dir, fn.name);
		dir.setItem(fn.name, file);
		return file;
	}

	public deleteFromPath(path: string): void {
		const fn = splitFileName(path);
		const dir = this.getDirectoryFromPath(fn.dir);
		if (dir) dir.deleteItem(fn.name);
	}

	public mkdir(path: string): VFSDirectory {
		return this.getDirectoryFromPath(path, true)!;
	}

	public refresh(path: string, list: FileInfo[]): VFSDirectory {
		const dir = <VFSDirectory>this.getDirectoryFromPath(path, true);
		dir.setByInfos(list);
		return dir;
	}
}

export class VFSServer extends VFSDirectory {
	public readonly hostUri: string;

	constructor(
		public readonly fs: VFSServerList,
		parent: VFSDirectory | undefined,
		name: string
	) {
		super(parent, name);
		const parsed = /^([a-zA-Z]*):\/\/(.*)@(.*)/.exec(name);
		if (parsed === null) throw Error(`Invalid Server Name ${name}`);
		const protocol = parsed[1];
		const username = parsed[2];
		const hostname = parsed[3];
		this.hostUri = `ftpkr://${username}@${protocol}-${hostname}`;
	}
}

export class VFSSymLink extends VFSState {
	constructor(parent: VFSDirectory, name: string) {
		super(parent, name);
		this.type = 'l';
	}

	public getLinkTarget(): VFSState | undefined {
		if (!this.server) return undefined;
		let link: VFSState | undefined = this;
		while (link instanceof VFSSymLink) {
			if (!link.link) return undefined;
			link = this.server.getFromPath(link.link);
		}
		return link;
	}
	public refreshContent(): Promise<void> {
		if (this.link) {
			const target = this.getLinkTarget();
			if (!target) return Promise.resolve();
			else return target.refreshContent();
		} else {
			return super.refreshContent();
		}
	}

	public serialize(): SerializedState {
		return {
			type: this.type,
			size: this.size,
			lmtime: this.lmtime,
			modified: this.remoteModified,
		};
	}
	public deserialize(data: SerializedState): void {
		this.size = Number(data.size) || 0;
		this.lmtime = this.lmtimeWithThreshold = Number(data.lmtime) || 0;
		this.remoteModified = Boolean(data.modified);
	}
}

export class VFSFile extends VFSState {
	constructor(parent: VFSDirectory, name: string) {
		super(parent, name);
		this.type = '-';
	}

	public serialize(): SerializedState {
		return {
			type: this.type,
			size: this.size,
			lmtime: this.lmtime,
			modified: this.remoteModified,
		};
	}
	public deserialize(data: SerializedState): void {
		this.size = Number(data.size) || 0;
		this.lmtime = this.lmtimeWithThreshold = Number(data.lmtime) || 0;
		this.remoteModified = Boolean(data.modified);
	}
}

export class VFSServerList extends VFSDirectory {
	public readonly onRefreshContent = Event.make<VFSState>(false);
	public readonly onRefreshTree = Event.make<VFSState>(false);
	/// ftpList -> fire onRefreshTree -> refreshTree -> readTreeNode -> ftpList

	constructor() {
		super(undefined, '');
	}

	public save(file: File, extra: SerializedStateRoot): void {
		const obj: SerializedStateRoot = Object.assign(this.serialize(), extra);
		obj.$version = 1;
		file.createSync(JSON.stringify(obj, null, 2));
	}

	public async load(
		file: File,
		defaultRootUrl: string
	): Promise<{ [key: string]: any }> {
		const extra: { [key: string]: any } = {};
		const datatext = await file.open();
		const data = JSON.parse(datatext);
		if (typeof data.$version !== 'object') {
			const version = data.$version;
			delete data.$version;
			switch (version) {
				case 1:
					for (const hostUrl in data) {
						if (hostUrl.startsWith('$')) {
							// option field
							extra[hostUrl] = data[hostUrl];
							continue;
						}
						const obj = data[hostUrl];
						if (typeof obj !== 'object') continue;
						this.putBySerialized(hostUrl, obj);
					}
					return extra;
			}
		}
		this.putBySerialized(defaultRootUrl, data);
		return extra;
	}

	public children(): Iterable<VFSServer> {
		return <Iterable<VFSServer>>super.children();
	}

	public item(hostUrl: string): VFSServer {
		const server = super.item(hostUrl);
		if (server) return <VFSServer>server;
		const nserver = new VFSServer(this, this, hostUrl);
		this.setItem(hostUrl, nserver);
		return nserver;
	}

	public setItem(name: string, item: VFSServer): void {
		super.setItem(name, item);
	}

	public putBySerialized(hostUrl: string, data: SerializedState): VFSServer {
		const server = this.item(hostUrl);
		server.deserialize(data);
		return server;
	}
}
