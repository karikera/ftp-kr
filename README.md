# ftp-kr README

This is FTP + Closure Compiler Extension for ME!

I'm not good at english, Sorry for my bad english ㅠㅠ

Start with `ftp-kr Init` command! (When exists workspace)

## Functions
FTP Functions:
* Real-Time FTP synchronization(You can off it!)
* Upload All without Same size file
* Download All without exists file
* Cleaning FTP files that Not in workspace
* Same file size -> It is Latest! -> Do not upload or download

Closure Compiler Functions:
* Compile to command "ftp-kr Closure Compile"
* Parse &lt;reference&gt; tag to include other js

## Available commands
* `ftp-kr Init` - Create ftp-kr.json.
* `ftp-kr Upload All` - Upload all files.
* `ftp-kr Download All` - Download all files.
* `ftp-kr Upload This` - Upload this file.
* `ftp-kr Download This` - Download this file.
* `ftp-kr Clean All` - Cleaning FTP files that Not in workspace.
* `ftp-kr Make Json` - Make json file for Closure compiler.
* `ftp-kr Closure Compile` - Compile by makejson from directory of opened file!
* `ftp-kr Closure Compile All` - Compile all of make.json in workspace!

## Release Notes

### 0.0.1

* I publish It!

### 0.0.2

* Fix closure compiler
* Add Download This command
* Add Upload This command 

### 0.0.3

* Add git repository address!

### 0.0.4

* Fix init command not found error (npm package dependency error)
* Fix init command error when not exists .vscode folder
* Fix ignorePath error of init command when use twice
* Fix download all command
* Decide to use MIT license

### 0.0.5
* Fix creating dot ended directory when open

### 0.0.6
* Fix init command

### 0.0.7
* Fix download all command

### 0.0.8
* Add config.fileNameEncoding option!
* Fix being mute with wrong connection
* Fix Upload All command
* Fix Closure Compile All command
* Do not stop batch work even occured error

### 0.0.9
* Split config.autosync -> config.autoUpload & config.autoDelete
* Set default value of config.autoDelete as false
* Init command will add new config field

### 0.0.10
* Fix closure compiler variable option remapping

**Enjoy!**