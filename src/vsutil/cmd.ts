
import File from '../util/file';
import * as ws from './ws';
import * as log from './log';
import * as work from './work';
import * as vsutil from './vsutil';
import * as error from './error';
import { commands, ExtensionContext } from 'vscode';

export interface Args
{
	file?:File;
	workspace?:ws.Workspace;
}

export type Command = {[key:string]:(args:Args)=>any};

async function runCommand(commands:Command, name:string, ...args:any[]):Promise<void>
{
	var cmdargs:Args = {};

	try
	{
		try
		{
			cmdargs.file = await vsutil.fileOrEditorFile(args[0]);
			cmdargs.workspace = ws.getFromFile(cmdargs.file);
		}
		catch(e)
		{
			if (!cmdargs.workspace) cmdargs.workspace = ws.Workspace.one();
		}

		const logger = cmdargs.workspace ? cmdargs.workspace.query(log.Logger) : log.defaultLogger;
		logger.verbose(`[Command] ${name}`);
		await commands[name](cmdargs);
	}
	catch(err)
	{
		const logger = cmdargs.workspace ? cmdargs.workspace.query(log.Logger) : log.defaultLogger;
		switch (err)
		{
		case 'PASSWORD_CANCEL':
			logger.verbose(`[Command:${name}]: cancelled by password input`);
			break;
		default:
			error.processError(logger, err);
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
