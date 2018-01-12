
import * as fs from './fs';
import * as log from './log';
import * as work from './work';
import * as vsutil from './vsutil';

export interface Args
{
	file?:fs.Path;
	workspace?:fs.Workspace;
}

export type Command = {[key:string]:(args:Args)=>any};

export const commands:Command = {};

export async function runCommand(name:string, ...args:any[]):Promise<void>
{
	var cmdargs:Args = {};

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

		await commands[name](cmdargs);
	}
	catch(err)
	{
		const logger = cmdargs.workspace ? cmdargs.workspace.item(log.Logger) : log.defaultLogger;
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