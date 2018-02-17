
import * as os from 'os';
import { window, workspace, Terminal } from 'vscode';
import { File } from 'krfile';

import { FtpCacher } from './ftpcacher';
import { vsutil } from './vsutil/vsutil';
import { Config } from './config';


const ssh_js = new File(__dirname + '/tool/ssh.js').fsPath;


function getShellType():string|undefined
{
    if (os.platform() !== 'win32') return;
	const terminalSettings = workspace.getConfiguration('terminal');
    var shellPath:string|undefined = terminalSettings.integrated.shell.windows;
	if (!shellPath) return undefined;
	shellPath = shellPath.toLowerCase();
	if (shellPath.endsWith('bash.exe')) return 'wslbash';
	if (shellPath.endsWith('cmd.exe')) return 'cmd';
}

export function openSshTerminal(server:FtpCacher):void
{
	const terminal = window.createTerminal(server.getName());

	var dir = server.workspace.fsPath;
	switch(getShellType())
	{
	case "wslbash":
		// c:\workspace\foo to /mnt/c/workspace/foo
		dir = dir.replace(/(\w):/, '/mnt/$1').replace(/\\/g, '/')
		break;
	case "cmd":
		// send 1st two characters (drive letter and colon) to the terminal
		// so that drive letter is updated before running cd
		terminal.sendText(dir.slice(0,2));
		break;
	}
	if (server.config.protocol !== 'sftp')
	{
		server.logger.errorConfirm('Cannot open SSH. Need to set protocol to sftp in ftp-kr.json', 'Open config')
		.then((res)=>{
			switch(res)
			{
			case 'Open config': vsutil.open(server.workspace.query(Config).path); break; 
			}
		});
		return;
	}
	
	terminal.sendText(`node "${ssh_js}" "${dir}" ${server.config.index}`);
	terminal.show();
}
