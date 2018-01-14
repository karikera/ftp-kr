
import * as file from './file';
import * as log from './log';
import * as work from './work';
import * as vsutil from './vsutil';
import { commands, ExtensionContext } from 'vscode';

export interface Args
{
	file?:file.File;
	workspace?:file.Workspace;
}

export type Command = {[key:string]:(args:Args)=>any};

async function runCommand(commands:Command, name:string, ...args:any[]):Promise<void>
{
	var cmdargs:Args = {};
	const logger = cmdargs.workspace ? cmdargs.workspace.query(log.Logger) : log.defaultLogger;

	try
	{
		try
		{
			cmdargs.file = await vsutil.fileOrEditorFile(args[0]);
			cmdargs.workspace = cmdargs.file.workspace();
		}
		catch(e)
		{
		}

		logger.verbose(`[Command] ${name}`);
		await commands[name](cmdargs);
	}
	catch(err)
	{
		switch (err)
		{
		case work.CANCELLED:
			logger.verbose(`[Command:${name}]: cancelled`);
			break;
		case 'PASSWORD_CANCEL':
			logger.verbose(`[Command:${name}]: cancelled by password input`);
			break;
		default:
			logger.error(err);
			break;
		}
	}
}

export function registerCommands(context:ExtensionContext, ...cmdlist:Command[])
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
