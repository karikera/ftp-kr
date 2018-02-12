
import {Options as FtpOptions} from 'ftp';
import {ConnectConfig as SftpOptions} from 'ssh2';

export type FileType = ''|'-'|'d'|'l';

export class FileInfo
{
	type:FileType = '';
	name:string = '';
	size:number = 0;
	date:number = 0;
	link:string|undefined;
}

export interface ServerConfig
{
	remotePath:string;
	protocol:string;

	fileNameEncoding:string;
	
	host:string;
	username:string;
	
	port?:number;
	ignoreWrongFileEncoding:boolean;
	
	name:string;

	password?:string;
	keepPasswordInMemory:boolean;
	
	passphrase?:string;
	connectionTimeout:number;
	autoDownloadRefreshTime:number;
	refreshTime:number;
	blockDetectingDuration:number;
	privateKey?:string;
	showGreeting:boolean;
	
	ftpOverride?:FtpOptions;
	sftpOverride?:SftpOptions;

	// generateds
	index:number; // 0 is the main server, 1 or more are alt servers
	url:string; // For visibility
	hostUrl:string; // It uses like the id
	passwordInMemory?:string; // temp password
}