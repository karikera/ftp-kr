import { File } from 'krfile';
import { commands, ExtensionContext, Uri, window } from 'vscode';
import { ftpTree } from '../ftptree';

import { processError } from './error';
import { FtpTreeItem } from './ftptreeitem';
import { defaultLogger, Logger } from './log';
import { Workspace } from './ws';

export class CommandArgs {
	file?: File;
	files?: File[];
	uri?: Uri;
	treeItem?: FtpTreeItem;
	workspace?: Workspace;
	openedFile?: boolean;

	private logger: Logger | null = null;

	getLogger(): Logger {
		if (this.logger === null) {
			this.logger = this.workspace
				? this.workspace.query(Logger)
				: defaultLogger;
		}
		return this.logger;
	}
}

export type Command = { [key: string]: (args: CommandArgs) => unknown };

async function runCommand(
	commands: Command,
	name: string,
	...args: unknown[]
): Promise<void> {
	const cmdargs = new CommandArgs();

	try {
		const arg = args[0];
		if (arg instanceof FtpTreeItem) {
			cmdargs.treeItem = arg;
			cmdargs.workspace = arg.server.workspace;
		} else {
			if (arg instanceof Uri) {
				if (arg.scheme === 'file') {
					cmdargs.file = new File(arg.fsPath);
					const files = args[1];
					if (files && files instanceof Array && files[0] instanceof Uri) {
						cmdargs.files = [];
						for (const uri of files) {
							if (uri.scheme === 'file') {
								cmdargs.files.push(new File(uri));
							}
						}
						if (cmdargs.files.indexOf(cmdargs.file) === -1)
							cmdargs.files.push(cmdargs.file);
					} else {
						cmdargs.files = [cmdargs.file];
					}
				} else {
					cmdargs.uri = arg;
					ftpTree.getServerFromUri(arg);
				}
			} else {
				const editor = window.activeTextEditor;
				if (editor) {
					const doc = editor.document;
					if (doc.uri.scheme === 'file') {
						cmdargs.file = new File(doc.uri.fsPath);
						cmdargs.files = [cmdargs.file];
						cmdargs.openedFile = true;
					}
					await doc.save();
				}
			}
			if (cmdargs.file) {
				cmdargs.workspace = Workspace.fromFile(cmdargs.file);
			}
		}

		cmdargs.getLogger().verbose(`[Command] ${name}`);
		await commands[name](cmdargs);
	} catch (err) {
		processError(cmdargs.getLogger(), err);
	}
}

export namespace Command {
	export function register(context: ExtensionContext, ...cmdlist: Command[]) {
		for (const cmds of cmdlist) {
			for (const name in cmds) {
				const disposable = commands.registerCommand(name, (...args) =>
					runCommand(cmds, name, ...args)
				);
				context.subscriptions.push(disposable);
			}
		}
	}
}
