# ftp-kr README

This is FTP + Closure Compiler Extension for ME!  
I'm not good at english, Sorry for my bad english ㅠㅠ

Start with `ftp-kr Init` command! (When exists workspace)

![init](images/init.png)

![init after](images/init-after.png)

![download all](images/downloadall.png)

By default, the auto-sync feature is enabled  
If you want to disable auto-sync, please set autoUpload/autoDelete to false  
![auto](images/autofeature.png)

You can see remote directory with `ftp-kr List` command!  
![list](images/list.png)

## Functions
FTP/SFTP Functions:
* Real-Time FTP/SFTP synchronization(You can off it!)
* Upload All without Same size file
* Download All without exists file
* Cleaning remote files that Not in workspace
* This extension check modification with file size
* Browse remote directory

Closure Compiler Functions:
* Compile with `ftp-kr Closure Compile` command
* Parse &lt;reference&gt; tag to include other js

## Available commands
* `ftp-kr: Init` - Create ftp-kr.json.
* `ftp-kr: Upload All` - Upload all files.
* `ftp-kr: Download All` - Download all files.
* `ftp-kr: Upload This` - Upload this file.
* `ftp-kr: Download This` - Download this file.
* `ftp-kr: Refresh All` - Rescan remote files.
* `ftp-kr: Clean All` - Cleaning remote files that Not in workspace.
* `ftp-kr: Refresh All` - Cleaning remote file list cache.
* `ftp-kr: List` - Show list of remote files.

## Available commands about Closure Compiler

* `ftp-kr: Make Json` - Create config file of Closure Compiler as make.json.
* `ftp-kr: Closure Compile` - Compile by makejson from directory of opened file!
* `ftp-kr: Closure Compile All` - Compile all of make.json in workspace!

**Enjoy!**