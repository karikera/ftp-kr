UNUSE
I want use it but I can't solve platform problem :(

const path = require('path');
const fs = require('fs');

var chilkat = null;
var key = null;

function init()
{
	if (key) return;
	const os = require('os');
	if (os.platform() == 'win32') {  
		chilkat = require('chilkat_win32'); 
	} else if (os.platform() == 'linux') {
		if (os.arch() == 'x86') {
			chilkat = require('chilkat_linux32');
		} else {
			chilkat = require('chilkat_linux64');
		}
	} else if (os.platform() == 'darwin') {
		chilkat = require('chilkat_macosx');
	}
	key = new chilkat.SshKey();
}

const ck = {
	/**
	 * @param {string} file
	 * @param {string} password
	 * @return {!Promise<string>}
	 */
	load(file, password)
	{
		return new Promise((resolve, reject)=>{
			if (path.extname(file).toLowerCase() === 'ppk')
			{
				resolve(ck.loadPPK(file, password));
			}
			else
			{
				fs.readFile(file, 'utf-8', (err, data)=>{
					if (err) reject(err);
					else resolve(data);
				});
			}
		});
	},
	/**
	 * @param {string} ppkfile
	 * @param {string} password
	 * @return {string}
	 */
	loadPPK(ppkfile, password)
	{
		init();
		key.Password = password;
		const keyStr = key.LoadText(ppkfile);
		if (!key.FromPuttyPrivateKey(keyStr))
		{
			throw Error(key.LastErrorText);
		}
		return key.ToOpenSshPrivateKey(false);
	}
};

module.exports = ck;