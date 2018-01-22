
import * as vscode from 'vscode';

import * as ws from '../vsutil/ws';
import * as log from '../vsutil/log';
import * as work from '../vsutil/work';
import * as vsutil from '../vsutil/vsutil';
import * as cmd from '../vsutil/cmd';

import * as cfg from '../config';

export const commands:cmd.Command = {
	async 'ftpkr.init'(args:cmd.Args)
	{
		args.workspace = await vsutil.createWorkspace();
		if (!args.workspace) return;
		const config = args.workspace.query(cfg.Config);
		await config.init();
	},

	async 'ftpkr.cancel'(args:cmd.Args)
	{
		for(const workspace of ws.Workspace.all())
		{
			workspace.query(work.Scheduler).cancel();
		}
	},
};

