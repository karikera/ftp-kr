## ftp-kr.json
* **closure**  (**DEPRECATED: Closure Compiler feature is splitted. If you want to use, Please download Closure Compiler extension.**)
* **disableFtp**  (**DEPRECATED: This option is deleted**)
* **altServer** (object[]) - alternate servers. It has similar properties with root manifest
* **createSyncCache** (boolean) - Create ftp-kr.cache.json file to save remote modification (default: true)
* **followLink** (boolean) - If it is true, extension will access symlink target or ignore symlink (default: false)
* **localBasePath** (string)
* **autoUpload** (boolean) - Upload file when save (default: false)
* **autoDelete** (boolean) - Delete FTP file when delete in workspace (default: false)
* **autoDownload** (boolean) - It will check modification of every opening and download if it modified (default: false)
* **autoDownloadAlways** (number) - Check server modification at set time intervals and download it. If it is zero, feature is disabled (default: 0)
* **viewSizeLimit** (number) - Bytes. File download size limit in ftp tree view (default: 4MiB)
* **downloadTimeExtraThreshold** (number) - Milliseconds. To avoid upload just downloaded file (default: 1000)
* **logLevel** (enum: VERBOSE, NORMAL) - Log level setting for debug (default: NORMAL)
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
* **autoDownloadRefreshTime** (integer) (**DEPRECATED: Use refreshTime instead**) - Milliseconds. Auto refresh after this value when set 'autoDownload' as true. default is 1000
* **blockDetectingDuration** (integer) - Milliseconds. If FTP connection is blocked for this value reconnect and retry action. default is 8000
* **refreshTime** (integer) - Milliseconds. re-list remote files After this duration. 'autoDownload' is affected by this property. default is 1000
* **showGreeting** (boolean) - Show FTP Greeting message. SFTP is not supported
* **ftpOverride**  - It will pass to connect function of nodejs ftp package
* **sftpOverride**  - It will pass to connect function of nodejs ssh2 package
