import { File } from 'krfile';
import { Client, ConnectConfig, SFTPWrapper } from 'ssh2';
import { FileInfo } from '../util/fileinfo';
import { ServerConfig } from '../util/serverinfo';
import { merge, promiseErrorWrap } from '../util/util';
import { FileInterface, FtpErrorCode, NOT_CREATED } from './fileinterface';
import { Workspace } from './ws';

export class SftpConnection extends FileInterface {
	private client: Client | null = null;
	private sftp: SFTPWrapper | null = null;

	constructor(workspace: Workspace, config: ServerConfig) {
		super(workspace, config);
	}

	connected(): boolean {
		return this.client !== null;
	}

	async _connect(password?: string): Promise<void> {
		try {
			if (this.client) throw Error('Already created');
			const client = (this.client = new Client());
			if (this.config.showGreeting) {
				client.on('banner', (msg: string) => this.log(msg));
			}

			let options: ConnectConfig = {};
			const config = this.config;
			if (config.privateKey) {
				const keyPath = config.privateKey;
				const keybuf = await this.workspace.child('.vscode', keyPath).open();
				options.privateKey = keybuf;
				options.passphrase = config.passphrase;
			} else {
				options.password = password;
			}
			options.host = config.host;
			(options.port = config.port ? config.port : 22),
				(options.username = config.username);
			// options.hostVerifier = (keyHash:string) => false;

			options = merge(options, config.sftpOverride);

			return await new Promise<void>((resolve, reject) => {
				client.on('ready', resolve).on('error', reject).connect(options);
			});
		} catch (err) {
			this._endSftp();
			if (this.client) {
				this.client.destroy();
				this.client = null;
			}
			switch (err.code) {
				case 'ECONNREFUSED':
					err.ftpCode = FtpErrorCode.CONNECTION_REFUSED;
					break;
				default:
					switch (err.message) {
						case 'Login incorrect.':
						case 'All configured authentication methods failed':
							err.ftpCode = FtpErrorCode.AUTH_FAILED;
							break;
					}
			}
			throw err;
		}
	}

	disconnect(): void {
		this._endSftp();
		if (this.client) {
			this.client.end();
			this.client = null;
		}
	}

	terminate(): void {
		this._endSftp();
		if (this.client) {
			this.client.destroy();
			this.client = null;
		}
	}

	exec(command: string): Promise<string> {
		return promiseErrorWrap(
			new Promise((resolve, reject) => {
				if (!this.client) return reject(Error(NOT_CREATED));
				this._endSftp();
				this.client.exec(command, (err, stream) => {
					if (err) return reject(err);
					let data = '';
					let errs = '';
					stream
						.on(
							'data',
							(stdout: string | undefined, stderr: string | undefined) => {
								if (stdout) data += stdout;
								if (stderr) errs += stderr;
							}
						)
						.on('error', (err: any) => reject(err))
						.on('exit', () => {
							if (errs) reject(Error(errs));
							else resolve(data.trim());
							stream.end();
						});
				});
			})
		);
	}

	pwd(): Promise<string> {
		return this.exec('pwd');
	}

	private _endSftp(): void {
		if (this.sftp) {
			this.sftp.end();
			this.sftp = null;
		}
	}
	private _getSftp(): Promise<SFTPWrapper> {
		return new Promise((resolve, reject) => {
			if (this.sftp) return resolve(this.sftp);
			if (!this.client) return reject(Error(NOT_CREATED));
			this.client.sftp((err, sftp) => {
				this.sftp = sftp;
				if (err) reject(err);
				else resolve(sftp);
			});
		});
	}

	_rmdir(ftppath: string): Promise<void> {
		return this._getSftp().then(
			(sftp) =>
				new Promise<void>((resolve, reject) => {
					return sftp.rmdir(ftppath, (err) => {
						if (err) {
							if (err.code === 2) err.ftpCode = FtpErrorCode.FILE_NOT_FOUND;
							reject(err);
						} else {
							resolve();
						}
					});
				})
		);
	}

	_delete(ftppath: string): Promise<void> {
		return this._getSftp().then(
			(sftp) =>
				new Promise<void>((resolve, reject) => {
					sftp.unlink(ftppath, (err) => {
						if (err) {
							if (err.code === 2) err.ftpCode = FtpErrorCode.FILE_NOT_FOUND;
							reject(err);
							return false;
						}
						resolve();
					});
				})
		);
	}

	_mkdir(ftppath: string): Promise<void> {
		return this._getSftp().then(
			(sftp) =>
				new Promise<void>((resolve, reject) => {
					sftp.mkdir(ftppath, (err) => {
						if (err) {
							if (err.code !== 3 && err.code !== 4 && err.code !== 5) {
								if (err.code === 2) {
									err.ftpCode = FtpErrorCode.REQUEST_RECURSIVE;
								}
								return reject(err);
							}
						}
						resolve();
					});
				})
		);
	}

	_put(localpath: File, ftppath: string): Promise<void> {
		return this._getSftp().then(
			(sftp) =>
				new Promise<void>((resolve, reject) => {
					sftp.fastPut(localpath.fsPath, ftppath, (err) => {
						if (err) {
							if (err.code === 2) err.ftpCode = FtpErrorCode.REQUEST_RECURSIVE;
							reject(err);
							return;
						}
						resolve();
					});
				})
		);
	}

	_write(buffer: Buffer, ftppath: string): Promise<void> {
		return this._getSftp().then(
			(sftp) =>
				new Promise<void>((resolve, reject) => {
					sftp.writeFile(ftppath, buffer, (err) => {
						if (err) {
							if (err.code === 2) err.ftpCode = FtpErrorCode.REQUEST_RECURSIVE;
							reject(err);
							return;
						}
						resolve();
					});
				})
		);
	}

	_get(ftppath: string): Promise<NodeJS.ReadableStream> {
		return this._getSftp()
			.then(
				(sftp) =>
					new Promise<NodeJS.ReadableStream>((resolve) => {
						const stream = sftp.createReadStream(ftppath, {
							encoding: <any>null,
						});
						resolve(stream);
					})
			)
			.catch((err) => {
				if (err.code === 2) err.ftpCode = FtpErrorCode.FILE_NOT_FOUND;
				else if (err.code === 550) err.ftpCode = FtpErrorCode.FILE_NOT_FOUND;
				throw err;
			});
	}

	_list(ftppath: string): Promise<FileInfo[]> {
		return this._getSftp().then(
			(sftp) =>
				new Promise<FileInfo[]>((resolve, reject) => {
					sftp.readdir(ftppath, (err, list) => {
						if (err) {
							if (err.code === 2) return resolve([]);
							else if (err.code === 550) return resolve([]);
							else reject(err);
							return;
						}

						if (!ftppath.endsWith('/')) ftppath += '/';

						// reset file info
						const nlist: FileInfo[] = new Array(list.length);
						for (let i = 0; i < list.length; i++) {
							const item = list[i];
							const to = new FileInfo();
							to.type = <any>item.longname.substr(0, 1);
							to.name = item.filename;
							to.date = item.attrs.mtime * 1000;
							to.size = +item.attrs.size;
							// const reg = /-/gi;
							// accessTime: item.attrs.atime * 1000,
							// rights: {
							// 	user: item.longname.substr(1, 3).replace(reg, ''),
							// 	group: item.longname.substr(4,3).replace(reg, ''),
							// 	other: item.longname.substr(7, 3).replace(reg, '')
							// },
							// owner: item.attrs.uid,
							// group: item.attrs.gid
							nlist[i] = to;
						}
						resolve(nlist);
					});
				})
		);
	}

	_readlink(fileinfo: FileInfo, ftppath: string): Promise<string> {
		return this._getSftp().then(
			(sftp) =>
				new Promise<string>((resolve, reject) => {
					sftp.readlink(ftppath, (err, target) => {
						if (err) return reject(err);
						fileinfo.link = target;
						resolve(target);
					});
				})
		);
	}

	_rename(ftppathFrom: string, ftppathTo: string): Promise<void> {
		return this._getSftp().then(
			(sftp) =>
				new Promise<void>((resolve, reject) => {
					sftp.rename(ftppathFrom, ftppathTo, (err) => {
						if (err) reject(err);
						else resolve();
					});
				})
		);
	}
}
