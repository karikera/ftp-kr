import {
	Disposable,
	Event,
	EventEmitter,
	FileChangeEvent,
	FileStat,
	FileSystemError,
	FileSystemProvider,
	FileType as VSCodeFileType,
	TreeDataProvider,
	TreeItem,
	Uri,
} from 'vscode';

import { VFSState } from './util/filesystem';

import { FtpCacher } from './ftpcacher';
import { FileType } from './util/fileinfo';
import { processError } from './vsutil/error';
import { FtpTreeItem, FtpTreeServer } from './vsutil/ftptreeitem';
import { defaultLogger } from './vsutil/log';

const toVSCodeFileType: Record<FileType, VSCodeFileType> = Object.create(null);
toVSCodeFileType['-'] = VSCodeFileType.File;
toVSCodeFileType['d'] = VSCodeFileType.Directory;
toVSCodeFileType['l'] = VSCodeFileType.SymbolicLink;

export class FtpTree
	implements TreeDataProvider<FtpTreeItem>, FileSystemProvider
{
	private readonly _onDidChangeTreeData: EventEmitter<FtpTreeItem> =
		new EventEmitter<FtpTreeItem>();
	readonly onDidChangeTreeData: Event<FtpTreeItem> =
		this._onDidChangeTreeData.event;

	private readonly _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
	readonly onDidChangeFile = this._onDidChangeFile.event;

	private readonly map = new Map<FtpCacher, FtpTreeServer>();

	watch(
		uri: Uri,
		options: { recursive: boolean; excludes: string[] }
	): Disposable {
		try {
			const server = ftpTree.getServerFromUri(uri);
			const ftppath = uri.path;
			const stat = server.ftp.toFtpFileFromFtpPath(ftppath);
			if (stat === undefined) {
				return new Disposable(() => {});
			}
			const watcher = stat.watch((to, from, type) => {
				const data: FileChangeEvent[] = [
					{
						type,
						uri: to.getUri(),
					},
				];
				this._onDidChangeFile.fire(data);
			}, options);
			return watcher;
		} catch (err) {
			return new Disposable(() => {});
		}
	}

	async readFile(uri: Uri): Promise<Buffer> {
		const server = ftpTree.getServerFromUri(uri);
		const ftppath = uri.path;
		const viewed = await server.ftp.downloadAsBuffer(ftppath);
		return viewed.content;
	}

	async writeFile(
		uri: Uri,
		content: Uint8Array,
		options: { create: boolean; overwrite: boolean }
	): Promise<void> {
		const server = ftpTree.getServerFromUri(uri);
		const ftppath = uri.path;
		options.create; // TODO: check
		options.overwrite; // TODO: check
		await server.ftp.uploadBuffer(ftppath, Buffer.from(content));
	}

	async delete(uri: Uri, options: { recursive: boolean }): Promise<void> {
		const server = ftpTree.getServerFromUri(uri);
		const ftppath = uri.path;
		options.recursive; // TODO: check
		await server.ftp.ftpDelete(ftppath);
	}

	async createDirectory(uri: Uri): Promise<void> {
		const server = ftpTree.getServerFromUri(uri);
		const ftppath = uri.path;
		await server.ftp.ftpMkdir(server.ftp.fromFtpPath(ftppath));
	}

	async readDirectory(uri: Uri): Promise<[string, VSCodeFileType][]> {
		const server = ftpTree.getServerFromUri(uri);
		const ftppath = uri.path;
		const dir = await server.ftp.ftpList(ftppath);
		const out: [string, VSCodeFileType][] = [];
		for (const child of dir.children()) {
			out.push([child.name, toVSCodeFileType[child.type]]);
		}
		return out;
	}

	async stat(uri: Uri): Promise<FileStat> {
		try {
			FileSystemError.FileNotFound(uri);
		} catch (err) {
			// empty
		}
		const server = ftpTree.getServerFromUri(uri);
		const ftppath = uri.path;
		const stat = await server.ftp.ftpStat(ftppath);
		if (stat === undefined) throw Error('File not found');

		return {
			type: toVSCodeFileType[stat.type],
			ctime: stat.date,
			mtime: stat.date,
			size: stat.size,
		};
	}

	async rename(
		oldUri: Uri,
		newUri: Uri,
		options: { overwrite: boolean }
	): Promise<void> {
		const server = ftpTree.getServerFromUri(oldUri);
		const newServer = ftpTree.getServerFromUri(newUri);
		options.overwrite; // TODO: check
		if (server !== newServer) {
			throw Error('Cross-server moving is not supported yet');
		} else {
			await server.ftp.ftpRename(
				server.ftp.fromFtpPath(oldUri.path),
				server.ftp.fromFtpPath(newUri.path)
			);
		}
	}

	public refreshTree(target?: VFSState): void {
		defaultLogger.verbose('refreshTree ' + (target ? target.getUri() : 'all'));
		if (!target) {
			FtpTreeItem.clear();
			this._onDidChangeTreeData.fire();
			for (const server of this.map.values()) {
				server.children = undefined;
				server.ftpFile = undefined;
			}
		} else {
			for (const item of FtpTreeItem.get(target)) {
				if (item.children) {
					for (const child of item.children) {
						FtpTreeItem.delete(child);
					}
					item.children = undefined;
				}
				if (item.server === item) {
					item.ftpFile = undefined;
				}
				this._onDidChangeTreeData.fire(item);
			}
		}
	}

	public getServerFromUri(uri: Uri): FtpTreeServer {
		const hostUri = `${uri.scheme}://${uri.authority}`;
		for (const server of this.map.values()) {
			if (hostUri === server.ftp.fs.hostUri) {
				return server;
			}
		}
		throw Error('Server not found: ' + uri);
	}

	public addServer(server: FtpCacher): void {
		const folder = new FtpTreeServer(server.workspace, server);
		this.map.set(server, folder);
	}

	public removeServer(server: FtpCacher): void {
		const folder = this.map.get(server);
		if (folder) {
			this.map.delete(server);
			folder.dispose();
		}
	}

	public getTreeItem(element: FtpTreeItem): TreeItem {
		return element;
	}

	public async getChildren(element?: FtpTreeItem): Promise<FtpTreeItem[]> {
		let logger = defaultLogger;
		try {
			if (!element) {
				return [...this.map.values()];
			} else {
				logger = element.server.logger;
				return await element.getChildren();
			}
		} catch (err) {
			processError(logger, err);
			return [];
		}
	}
}

export const ftpTree = new FtpTree();
