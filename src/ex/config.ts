
import * as vscode from 'vscode';

import * as fs from '../util/fs';
import * as log from '../util/log';
import * as work from '../util/work';
import * as vsutil from '../util/vsutil';
import * as cmd from '../util/cmd';
import * as event from '../util/event';
import * as cfg from '../config';
import * as ftpsync from '../ftpsync';

cmd.commands['ftpkr.init'] = async(args:cmd.Args)=>{
	args.workspace = await vsutil.createWorkspace();
	if (!args.workspace) return;
	const config = args.workspace.query(cfg.Config);
	config.init();
};

cmd.commands['ftpkr.cancel'] = (args:cmd.Args)=>{
	for(const workspace of fs.Workspace.all())
	{
		workspace.query(work.Scheduler).cancel();
	}
};
