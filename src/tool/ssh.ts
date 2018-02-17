
import { Client, ConnectConfig, ClientChannel } from 'ssh2';
import read = require('read');
import { File } from 'krfile';

import { FtpKrConfig } from '../util/ftpkr_config';
import { ServerConfig } from '../util/serverinfo';
import { merge } from '../util/util';

if (process.stdin.setRawMode) process.stdin.setRawMode( true );

process.stdin.resume();
process.argv[0]; // node
process.argv[1]; // js
const workspaceDir = new File(process.argv[2]+''); // workspaceDir
const serverIdx = +process.argv[3] |0; // serverIndex

var onsigint = ()=>{};

var stream:ClientChannel|null = null;

function setStream(s:ClientChannel|null):void
{
	if (stream)
	{
		stream.stdout.unpipe();
		stream.stderr.unpipe();
		process.stdin.unpipe();
	}
	stream = s;
	if (s)
	{
		s.stdout.pipe(process.stdout);
		s.stderr.pipe(process.stderr);
		process.stdin.pipe(s);
	}
}

process.stdout.on('resize', ()=>{
	const rows = process.stdout.rows||0;
	const columns = process.stdout.columns||0;
	// VSCode terminal character size: 7x17 (calculated with my screenshot!)
	if (stream) stream.setWindow(rows, columns, rows * 17, columns * 7);
});


async function main():Promise<void>
{
	const ftpKrConfig = new FtpKrConfig(workspaceDir);
	await ftpKrConfig.readJson();
	
	const config:ServerConfig = serverIdx === 0 ? ftpKrConfig : ftpKrConfig.altServer[serverIdx - 1];
	if (!config)
	{
		console.error("Server index overflow: "+serverIdx);
		return;
	}

	if (config.protocol !== 'sftp')
	{
		console.error('Need sftp protocol');
		return;
	}

	var options:ConnectConfig = {};
	if (config.privateKey)
	{
		var keyPath = config.privateKey;
		const keybuf = await workspaceDir.child('.vscode',keyPath).open();
		options.privateKey = keybuf;
		options.passphrase = config.passphrase;
	}
	else
	{
		const password = await new Promise<string>((resolve, reject)=>read({prompt:"Password: ", silent:true}, (err, result)=>{
			if (err) reject(err);
			else resolve(result);
		}));
		options.password = password;
	}
	options.host = config.host;
	options.port = config.port ? config.port : 22,
	options.username = config.username;
	// options.hostVerifier = (keyHash:string) => false;
	
	options = merge(options, config.sftpOverride);

	for (;;)
	{
		const client = new Client;
		await new Promise<void>((resolve, reject) => {
			client.on('ready', resolve)
			.on('error', reject)
			.connect(options);
		});
		client.shell(
			{cols:process.stdout.columns, rows:process.stdout.rows, term: 'xterm-256color'}, 
			(err, stream)=>{
			stream.allowHalfOpen = true;
			stream.write(`cd ${config.remotePath}\n`);
			setStream(stream);
		});
	
		await new Promise<void>(resolve=>client.once('close', resolve));
		setStream(null);
	}
}

main().catch(err=>{
	switch (err)
	{
	case 'NOTFOUND':
		console.error('ftp-kr.json not found in '+workspaceDir);
		break;
	default:
		console.error(err);
		break;
	}
	process.exit(-1);
});

