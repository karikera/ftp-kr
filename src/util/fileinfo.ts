
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
	name?:string;
	remotePath?:string;
	protocol?:string;
	fileNameEncoding?:string;
	url?:string;

	host?:string;
	username?:string;
	password?:string;
	keepPasswordInMemory?:boolean;
	port?:number;
	ignoreWrongFileEncoding?:boolean;
	createSyncCache?:boolean;
	
	passphrase?:string;
	connectionTimeout?:number;
	autoDownloadRefreshTime?:number;
	blockDetectingDuration?:number;
	refreshTime?:number;
	privateKey?:string;
	showGreeting?:boolean;
	
	ftpOverride?:FtpOptions;
	sftpOverride?:SftpOptions;
	
	passwordInMemory?:string;
}
