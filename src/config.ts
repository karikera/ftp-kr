import { File } from 'krfile';
import 'krjson';
import { getLoadErrorMessage, LoadError } from './ftpmgr';
import { Event } from './util/event';
import { FtpKrConfig } from './util/ftpkr_config';
import { FtpKrConfigProperties } from './util/serverinfo';
import { Deferred } from './util/util';
import { processError } from './vsutil/error';
import { Logger, StringError } from './vsutil/log';
import { vsutil } from './vsutil/vsutil';
import { Scheduler, Task } from './vsutil/work';
import { Workspace, WorkspaceItem } from './vsutil/ws';

const REGEXP_MAP: { [key: string]: string } = {
	'.': '\\.',
	'+': '\\+',
	'?': '\\?',
	'[': '\\[',
	']': '\\]',
	'^': '^]',
	$: '$]',
	'*': '[^/]*',
	'**': '.*',
};

export enum ConfigState {
	LOADING,
	NOTFOUND,
	INVALID,
	LOADED,
}

function patternToRegExp(pattern: string): RegExp {
	let regexp = pattern.replace(/([.?+[\]^$]|\*\*?)/g, (chr) => REGEXP_MAP[chr]);
	if (regexp.startsWith('/')) regexp = '^' + regexp;
	else regexp = '.*/' + regexp;
	if (!regexp.endsWith('/')) regexp += '(/.*)?$';
	return new RegExp(regexp);
}

export class Config extends FtpKrConfig implements WorkspaceItem {
	private state: ConfigState = ConfigState.LOADING;
	private lastError: unknown = null;
	private basePath: File | undefined = undefined;

	private loadingPromise: Deferred<void> | null = new Deferred<void>();
	public readonly onLoad = Event.make<Task>(false);
	public readonly onLoadAfter = Event.make<void>(false);
	public readonly onInvalid = Event.make<void>(false);
	public readonly onNotFound = Event.make<void>(true);

	private ignorePatterns: RegExp[] | null = null;
	private readonly logger: Logger;
	private readonly scheduler: Scheduler;

	constructor(private workspace: Workspace) {
		super(workspace);

		this.logger = workspace.query(Logger);
		this.scheduler = workspace.query(Scheduler);
	}

	dispose() {
		// do nothing
	}

	getBasePath(): File {
		if (this.basePath === undefined) throw Error('basePath is not defined');
		return this.basePath;
	}

	public async modifySave(
		cb: (cfg: FtpKrConfigProperties) => void
	): Promise<void> {
		const json = await this.path.json();
		cb(json);
		cb(this);
		await this.path.create(JSON.stringify(json, null, 4));
	}

	public updateIgnorePath(): void {
		this.ignorePatterns = null;
	}

	/**
	 * if true, path needs to ignore
	 */
	public checkIgnorePath(path: File): boolean {
		if (!this.ignorePatterns) {
			this.ignorePatterns = this.ignore.map(patternToRegExp);
		}

		const pathFromWorkspace = '/' + path.relativeFrom(this.workspace);
		for (const pattern of this.ignorePatterns) {
			if (pattern.test(pathFromWorkspace)) {
				return true;
			}
		}
		return false;
	}

	public init(): void {
		this.runTask('init', async () => {
			await this.initJson();
			vsutil.open(this.path);
		});
	}

	public setState(newState: ConfigState, newLastError: unknown): void {
		if (this.state === newState) return;
		this.state = newState;
		this.lastError = newLastError;
		this.logger.verbose(
			`${this.workspace.name}.state = ${ConfigState[newState]}`
		);
	}

	public load(): void {
		this.loadAndRunTask('config loading', () => this.readJson());
	}

	private fireNotFound(): Promise<void> {
		if (this.state === ConfigState.NOTFOUND) return Promise.resolve();

		this.setState(ConfigState.NOTFOUND, 'NOTFOUND');
		return this.onNotFound.fire();
	}

	private fireInvalid(err: unknown): Promise<void> {
		if (this.state === ConfigState.INVALID) return Promise.resolve();

		this.setState(ConfigState.INVALID, err);
		return this.onInvalid.fire();
	}

	private async onLoadError(err: unknown): Promise<void> {
		let throwValue: unknown;
		switch (err) {
			case LoadError.NOTFOUND:
				this.logger.message('/.vscode/ftp-kr.json: Not found');
				await this.fireNotFound();
				throwValue = StringError.IGNORE;
				break;
			case LoadError.CONNECTION_FAILED:
				vsutil.info('ftp-kr Connection Failed', 'Retry').then((confirm) => {
					if (confirm === 'Retry') {
						this.loadAndRunTask('login');
					}
				});
				await this.fireInvalid(err);
				throwValue = StringError.IGNORE;
				break;
			case LoadError.PASSWORD_CANCEL:
				vsutil.info('ftp-kr Login Request', 'Login').then((confirm) => {
					if (confirm === 'Login') {
						this.loadAndRunTask('login');
					}
				});
				await this.fireInvalid(err);
				throwValue = StringError.IGNORE;
				break;
			case LoadError.AUTH_FAILED:
				this.logger.message(getLoadErrorMessage(err));
				await this.fireInvalid(err);
				throwValue = StringError.IGNORE;
				break;
			default:
				if (err instanceof Error) err.file = this.path;
				await this.fireInvalid(err);
				throwValue = err;
				break;
		}
		if (this.loadingPromise !== null) {
			this.loadingPromise.reject(throwValue);
			this.loadingPromise = null;
		}
		throw throwValue;
	}

	public loadTest(): Promise<void> {
		if (this.state !== ConfigState.LOADED) {
			if (this.state === ConfigState.NOTFOUND) {
				return Promise.reject('ftp-kr.json is not defined');
			}
			if (this.state === ConfigState.LOADING) {
				return this.loadingPromise!;
			}
			return this.onLoadError(this.lastError);
		}
		return Promise.resolve();
	}

	/**
	 * path from localBasePath
	 */
	public workpath(file: File): string {
		if (this.basePath === undefined) throw Error('basePath is not defined');
		const workpath = file.relativeFrom(this.basePath);
		if (workpath === undefined) {
			if (this.basePath !== this.workspace) {
				throw Error(`${file.fsPath} is not in localBasePath`);
			} else {
				throw Error(`${file.fsPath} is not in workspace`);
			}
		}
		return '/' + workpath;
	}

	public fromWorkpath(workpath: string, parent?: File): File {
		if (this.basePath === undefined) throw Error('basePath is not defined');
		if (workpath.startsWith('/')) {
			return this.basePath.child(workpath.substr(1));
		} else {
			return (parent ?? this.basePath).child(workpath);
		}
	}

	private async runTask(
		name: string,
		onwork: (task: Task) => Promise<void>
	): Promise<void> {
		await this.scheduler.cancel();
		try {
			await this.scheduler.taskMust(name, async (task) => {
				await onwork(task);

				this.ignorePatterns = null;
				if (this.localBasePath) {
					this.basePath = this.workspace.child(this.localBasePath);
				} else {
					this.basePath = this.workspace;
				}
			});
		} catch (err) {
			processError(this.logger, err);
		}
	}
	private async loadAndRunTask(
		name: string,
		taskBefore?: (task: Task) => Promise<void>
	): Promise<void> {
		await this.scheduler.cancel();
		try {
			await this.scheduler.taskMust(name, async (task) => {
				try {
					this.logger.message('/.vscode/ftp-kr.json: Loading');
					this.loadingPromise = new Deferred<void>();
					this.setState(ConfigState.LOADING, null);
					if (taskBefore !== undefined) await taskBefore(task);

					this.ignorePatterns = null;
					if (this.localBasePath) {
						this.basePath = this.workspace.child(this.localBasePath);
					} else {
						this.basePath = this.workspace;
					}

					this.logger.dontOpen = this.dontOpenOutput;
					this.logger.setLogLevel(this.logLevel);

					await this.onLoad.fire(task);
					this.logger.message('/.vscode/ftp-kr.json: Loaded successfully');
					this.setState(ConfigState.LOADED, null);
					if (this.loadingPromise !== null) {
						this.loadingPromise.resolve();
						this.loadingPromise = null;
					}
				} catch (err) {
					await this.onLoadError(err);
				}
			});
			await this.onLoadAfter.fire();
		} catch (err) {
			processError(this.logger, err);
		}
	}

	public reportTaskCompletion(taskname: string, startTime: number): void {
		if (this.showReportMessage !== false) {
			const passedTime = Date.now() - startTime;
			if (passedTime >= this.showReportMessage) {
				vsutil.info(taskname + ' completed');
			}
		}
		this.logger.show();
		this.logger.message(taskname + ' completed');
	}

	public async reportTaskCompletionPromise<T>(
		taskname: string,
		taskpromise: Promise<T>
	): Promise<T> {
		const startTime = Date.now();
		const res = await taskpromise;
		if (this.showReportMessage !== false) {
			const passedTime = Date.now() - startTime;
			if (passedTime >= this.showReportMessage) {
				vsutil.info(taskname + ' completed');
			}
		}
		return res;
	}
}
