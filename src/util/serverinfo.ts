
import {Options as FtpOptions} from 'ftp';
import {ConnectConfig as SftpOptions} from 'ssh2';

export interface ServerConfig
{
	remotePath:string;
	protocol:string;

	fileNameEncoding:string;
	
	host:string;
	username:string;
	secure:boolean;
	
	port?:number;
	ignoreWrongFileEncoding:boolean;
	
	name?:string;

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

export type LogLevel = 'VERBOSE' | 'NORMAL' | 'ERROR';
