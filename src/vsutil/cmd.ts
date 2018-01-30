
import { commands, ExtensionContext, Uri } from 'vscode';

import { File } from '../util/file';
import { VFSState } from '../util/filesystem';

import { vsutil } from './vsutil';
import { processError } from './error';
import { defaultLogger, Logger } from './log';
import { Workspace } from './ws';

export interface CommandArgs
{
	file?:File;
	ftpfile?:VFSState;
	uri?:Uri;
	workspace?:Workspace;
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
			if (arg instanceof Uri)
			{
				cmdargs.uri = arg;
			}
			else if (arg instanceof VFSState)
			{
				cmdargs.ftpfile = arg;
				arg.getPath();
			}
			cmdargs.file = await vsutil.fileOrEditorFile(args[0]);
			cmdargs.workspace = Workspace.fromFile(cmdargs.file);
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
