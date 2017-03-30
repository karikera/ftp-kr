# 1.0.0
* Set version to 1.0.0 without much meaning
* Port all javascript to typescript
* Use ftp-ssl when set protocol to `ftps`
* Add `ftpOverride` and `sftpOverride` field, It can force override option of ftp/sftp connection

# 0.0.26
* Fix SFTP private key absolute path problem

# 0.0.25
* SFTP private key support  
![privatekey](images/privatekey.png)

# 0.0.24
* Update Closure compiler to v20170124

# 0.0.23
* Add `autoDownload` option, It check modification and download every opening

# 0.0.22
* Add connectionTimeout option
* Do not opens up output for every connection

# 0.0.21
* Fix ignore list did not apply to `Download/Clean All` command
* Reverse ordering of CHANGELOG.md
* Add `List` command  
![list](images/list.png)

# 0.0.20
* Fix `Download/Clean All` commands
* Add `Refresh All` command

# 0.0.19
* Add missing module

# 0.0.18
* Show notification when task takes longer then 1 second
* Add SFTP support
* Fix `Upload/Download this` in file menu
* If use `Upload/Download this` at directory it will use `Upload/Download All` command

# 0.0.17
* Add generate button when not found make.json

# 0.0.16
* Update closure compiler to v20161201

# 0.0.15
* Fix disableFtp option

# 0.0.14
* Add disableFtp option

# 0.0.13
* Fix invalid error when multiple init command
* Add detail button in error message
* Add image to README.md

# 0.0.12
* Change output as ftp-kr when use Closure-Compiler
* If make.json is not found use the latest one

# 0.0.11
* Add config.createSyncCache option! default is true
* Implement array option inheritance for Closure-Compiler settings!
* Add json schema
* Make Json command will add new config field

# 0.0.10
* Fix Closure-Compiler variable option remapping

# 0.0.9
* Split config.autosync -> config.autoUpload & config.autoDelete
* Set default value of config.autoDelete as false
* Init command will add new config field

# 0.0.8
* Add config.fileNameEncoding option!
* Fix being mute with wrong connection
* Fix Upload All command
* Fix Closure Compile All command
* Do not stop batch work even occured error

# 0.0.7
* Fix download all command

# 0.0.6
* Fix init command

# 0.0.5
* Fix creating dot ended directory when open

# 0.0.4

* Fix init command not found error (npm package dependency error)
* Fix init command error when not exists .vscode folder
* Fix ignorePath error of init command when use twice
* Fix download all command
* Decide to use MIT license

# 0.0.3

* Add git repository address!

# 0.0.2

* Fix Closure-Compiler
* Add Download This command
* Add Upload This command 

# 0.0.1

* I publish It!
