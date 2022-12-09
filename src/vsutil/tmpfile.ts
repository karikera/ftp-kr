import { File } from 'krfile';
import { commands, Disposable, TextDocument, Uri, workspace } from 'vscode';

let disposer: Disposable | null = null;
const listenMap = new Map<string, () => void>();

function onCloseDoc(e: TextDocument) {
	fireListen(e.uri.fsPath);
}

function fireListen(fileName: string): void {
	const cb = listenMap.get(fileName);
	if (cb !== undefined) {
		listenMap.delete(fileName);
		if (listenMap.size === 0) {
			if (disposer === null) throw Error('Invalid state');
			disposer.dispose();
			disposer = null;
		}
		cb();
	}
}

function listen(fileName: string, cb: () => void): void {
	if (listenMap.has(fileName)) throw Error(`listener overlapped: ${fileName}`);
	listenMap.set(fileName, cb);
	if (disposer === null) {
		disposer = workspace.onDidCloseTextDocument(onCloseDoc);
	}
}

export class TemporalDocument {
	public readonly onClose: Promise<void>;
	private readonly editorFileUri: Uri;
	private closed = false;

	constructor(
		public readonly editorFile: File,
		public readonly targetFile: File
	) {
		this.editorFileUri = Uri.file(this.editorFile.fsPath);
		this.onClose = new Promise((resolve) =>
			listen(this.editorFileUri.fsPath, () => {
				this._close();
				resolve();
			})
		);
	}

	private _close(): void {
		if (this.closed) return;
		this.closed = true;
		this.targetFile.quietUnlink();
	}

	close(): void {
		if (this.closed) return;
		this._close();
		commands.executeCommand('vscode.open', this.editorFileUri);
		commands.executeCommand('workbench.action.closeActiveEditor');
		fireListen(this.editorFileUri.fsPath);
	}
}
