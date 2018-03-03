
import { commands, ExtensionContext, Uri, window } from 'vscode';
import { File } from 'krfile';

import { VFSState } from '../util/filesystem';

import { vsutil } from './vsutil';
import { processError } from './error';
import { defaultLogger, Logger } from './log';
import { Workspace } from './ws';
import { FtpTreeItem } from './ftptreeitem';

export interface CommandArgs
{
	file?:File;
	files?:File[];
	uri?:Uri;
	treeItem?:FtpTreeItem;
	workspace?:Workspace;
	openedFile?:boolean;
}

export type Command = {[key:string]:(args:CommandArgs)=>any};

async function runCommand(commands:Command, name:string, ...args:any[]):Promise<void>
{
	var cmdargs:CommandArgs = {};

	try
	{
		try
		{
			const arg = args[0];
			if (arg instanceof FtpTreeItem)
			{
				cmdargs.treeItem = arg;
			}
			else
			{
				if (arg instanceof Uri)
				{
					if (arg.scheme === 'file')
					{
						cmdargs.file = new File(arg.fsPath);
						const files = args[1];
						if (files && (files instanceof Array) && (files[0] instanceof Uri))
						{
							cmdargs.files = files.map((uri:Uri)=>new File(uri.fsPath));
						}
						else
						{
							cmdargs.files = [cmdargs.file];
						}
					}
					else
					{
						cmdargs.uri = arg;
					}
				}
				else
				{
					const editor = window.activeTextEditor;
					if (editor)
					{
						const doc = editor.document;
						cmdargs.file = new File(doc.uri.fsPath);
						cmdargs.files = [cmdargs.file];
						cmdargs.openedFile = true;
						await doc.save();
					}
				}
				if (cmdargs.file)
				{
					cmdargs.workspace = Workspace.fromFile(cmdargs.file);
				}
			}
		}
		catch(e)
		{
			if (!cmdargs.workspace) cmdargs.workspace = Workspace.one();
		}

		const logger = cmdargs.workspace ? cmdargs.workspace.query(Logger) : defaultLogger;
		logger.verbose(`[Command] ${name}`);
		await commands[name](cmdargs);
	}
	catch(err)
	{
		const logger = cmdargs.workspace ? cmdargs.workspace.query(Logger) : defaultLogger;
		switch (err)
		{
		case 'PASSWORD_CANCEL':
			logger.verbose(`[Command:${name}]: cancelled by password input`);
			break;
		default:
			processError(logger, err);
			break;
		}
	}
}

export namespace Command {
	export function register(context:ExtensionContext, ...cmdlist:Command[])
	{
		for(const cmds of cmdlist)
		{
			for (const name in cmds)
			{
				const disposable = commands.registerCommand(name, (...args) => runCommand(cmds, name, ...args));
				context.subscriptions.push(disposable);
			}
		}
	}
	
}
