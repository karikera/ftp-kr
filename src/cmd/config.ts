
import { vsutil } from '../vsutil/vsutil';
import { Command, CommandArgs } from '../vsutil/cmd';
import { Config } from '../config';
import { Workspace } from '../vsutil/ws';
import { Scheduler } from '../vsutil/work';

export const commands:Command = {
	async 'ftpkr.init'(args:CommandArgs)
	{
		args.workspace = await vsutil.createWorkspace();
		if (!args.workspace) return;
		const config = args.workspace.query(Config);
		config.init();
	},

	async 'ftpkr.cancel'(args:CommandArgs)
	{
		for(const workspace of Workspace.all())
		{
			workspace.query(Scheduler).cancel();
		}
	},
};

