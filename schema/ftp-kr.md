## ftp-kr.json
* **closure**  (**DEPRECATED: Closure Compiler feature is splitted. If you want to use, Please download Closure Compiler extension.**)
* **altServer** (object[]) - alternate servers. It has similar properties with root manifest
* **localBasePath** (string)
* **autoUpload** (boolean) - Upload file when save
* **autoDelete** (boolean) - Delete FTP file when delete in workspace
* **autoDownload** (boolean) - It will check modification of every opening and download if it modified
* **logLevel** (enum: VERBOSE, NORMAL) - Log level setting for debug
* **ignore** (string[]) - Ignore file or directory list. Is NOT glob pattern
* **protocol** (enum: ftp, sftp, ftps) - Connection protocol
* **sslProtocol**  -  Optional SSL method to use, default is "SSLv23_method". The possible values are listed as https://www.openssl.org/docs/man1.0.2/ssl/ssl.html#DEALING-WITH-PROTOCOL-METHODS , use the function names as strings. For example, "SSLv3_method" to force SSL version 3.
* **host** (string) - Address of the FTP/SFTP server
* **username** (string) - FTP/SFTP user name
* **password** (string) - FTP/SFTP password
* **keepPasswordInMemory** (boolean) - Keep password into internal variable for reconnection (default: false)
* **remotePath** (string) - FTP/SFTP side directory
* **port** (integer) - Port number of FTP/SFTP server. If it is zero, use the default port
* **privateKey** (string) - Private key file for SFTP connection. Use OpenSSH format. If it is non empty, password will be ignored
* **passphrase** (string) - Password for an encrypted private key.
* **connectionTimeout** (integer) - Disconnect from FTP/SFTP server after timeout(ms) (default: 60000)
* **fileNameEncoding**  - Filename encoding for FTP. Encoding with iconv-lite.
 See all supported encodings: https://github.com/ashtuchkin/iconv-lite/wiki/Supported-Encodings
* **ignoreWrongFileEncoding** (boolean) - Suppress of the file encoding error assumption
* **createSyncCache** (boolean) (**DEPRECATED: sync cache feature is removed**) - Create sync.json file for next FTP access(Not effective ' -';)
* **autoDownloadRefreshTime** (integer) (**DEPRECATED: Use refreshTime instead**) - Milliseconds. Auto refresh after this value when set 'autoDownload' as true. default is 1000
* **blockDetectingDuration** (integer) - Milliseconds. If FTP connection is blocked for this value reconnect and retry action. default is 8000
* **refreshTime** (integer) - Milliseconds. re-list remote files After this duration. 'autoDownload' is affected by this property. default is 1000
* **showGreeting** (boolean) - Show FTP Greeting message. SFTP is not supported
* **ftpOverride** 
* **sftpOverride** 
