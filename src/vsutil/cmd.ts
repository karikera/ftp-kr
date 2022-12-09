import { File } from 'krfile';
import { commands, ExtensionContext, Uri, window } from 'vscode';

import { processError } from './error';
import { FtpTreeItem } from './ftptreeitem';
import { defaultLogger, Logger } from './log';
import { Workspace } from './ws';

export interface CommandArgs {
	file?: File;
	files?: File[];
	uri?: Uri;
	treeItem?: FtpTreeItem;
	workspace?: Workspace;
	openedFile?: boolean;
}

export type Command = { [key: string]: (args: CommandArgs) => unknown };

async function runCommand(
	commands: Command,
	name: string,
	...args: unknown[]
): Promise<void> {
	const cmdargs: CommandArgs = {};

	try {
		try {
			const arg = args[0];
			if (arg instanceof FtpTreeItem) {
				cmdargs.treeItem = arg;
			} else {
				if (arg instanceof Uri) {
					if (arg.scheme === 'file') {
						cmdargs.file = new File(arg.fsPath);
						const files = args[1];
						if (files && files instanceof Array && files[0] instanceof Uri) {
							cmdargs.files = files.map((uri: Uri) => new File(uri.fsPath));
						} else {
							cmdargs.files = [cmdargs.file];
						}
					} else {
						cmdargs.uri = arg;
					}
				} else {
					const editor = window.activeTextEditor;
					if (editor) {
						const doc = editor.document;
						cmdargs.file = new File(doc.uri.fsPath);
						cmdargs.files = [cmdargs.file];
						cmdargs.openedFile = true;
						await doc.save();
					}
				}
				if (cmdargs.file) {
					cmdargs.workspace = Workspace.fromFile(cmdargs.file);
				}
			}
		} catch (e) {
			if (!cmdargs.workspace) cmdargs.workspace = Workspace.one();
		}

		const logger = cmdargs.workspace
			? cmdargs.workspace.query(Logger)
			: defaultLogger;
		logger.verbose(`[Command] ${name}`);
		await commands[name](cmdargs);
	} catch (err) {
		const logger = cmdargs.workspace
			? cmdargs.workspace.query(Logger)
			: defaultLogger;
		processError(logger, err);
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
