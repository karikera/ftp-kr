
const Client = require("ftp");
const config = require('./config');
const util = require('./util');
const ofs = require('fs');
const iconv = require('iconv-lite');

var client = null;

function bin2str(bin)
{
    var buf = iconv.encode(bin, 'binary');
    return iconv.decode(buf, config.fileNameEncoding);
}
function str2bin(str)
{
    var buf = iconv.encode(str, config.fileNameEncoding);
    return iconv.decode(buf, 'binary');
}
function toftpPath(workpath)
{
    return str2bin(config.remotePath+workpath);
}

/**
 * @returns {Promise}
 */
function init()
{
    if (client)
    {
        updateDestroyTimeout();
        return Promise.resolve();
    }

    return new Promise(function(resolve, reject){
        client = new Client;
        client.on("ready", function(){
            var socket = client._socket;
            var oldwrite = socket.write;
            socket.write = function(str){
                return oldwrite.call(socket, str, 'binary');
            };
            updateDestroyTimeout();
            resolve();
        });
        client.on("error", function(e){
            reject(e);
            if (client)
            {
                client.end();
                client = null;
            }
        });
        client.connect({
            host: config.host,
            port: config.port, 
            user: config.username, 
            password: config.password
        });
    });
}

function _errorWrap(err)
{
    return new Error(err.message +"["+err.code+"]");
}

function _simpleFtpFunction(name, workpath, ignorecode, callback)
{
    cancelDestroyTimeout();
    return new Promise(function(resolve, reject)
    {
        util.setState(name +" "+workpath);
        util.log(name +": "+workpath);
        var ftppath = toftpPath(workpath);
        callback(ftppath, function(err){
            util.setState("");
            updateDestroyTimeout();
            if (!err) return resolve();
            if (err.code === ignorecode) return resolve();
            util.log(name+" fail: "+workpath);
            return reject(_errorWrap(err));
        });
    });
}

/**
 * @param {string} workpath
 * @returns {Promise}
 */
function _rmdir(workpath)
{
    return _simpleFtpFunction("rmdir", workpath, 550, 
        (ftppath, cb)=>client.rmdir(ftppath, true, cb));
}

/**
 * @param {string} workpath
 * @returns {Promise}
 */
function _delete(workpath)
{
    return _simpleFtpFunction("delete", workpath, 550,
        (ftppath, cb)=>client.delete(ftppath, cb));
}

/**
 * @param {string} workpath
 * @returns {Promise}
 */
function _mkdir(workpath)
{
    return _simpleFtpFunction("mkdir", workpath, 0,
        (ftppath, cb)=>client.mkdir(ftppath, true, cb));
}

/**
 * @param {string} workpath
 * @param {string} localpath
 * @returns {Promise}
 */
function _upload(workpath, localpath)
{
    cancelDestroyTimeout();
    return new Promise(function(resolve, reject)
    {
        util.setState("upload "+workpath);
        util.log("upload: "+workpath);
        var ftppath = toftpPath(workpath);

        function success()
        {
            util.setState("");
            updateDestroyTimeout();
            resolve();
        }
        function fail(err)
        {
            util.setState("");
            updateDestroyTimeout();
            util.log("upload fail: "+workpath);
            reject(_errorWrap(err));
        }
        
        function onup2(err)
        {
            if (!err) success();
            else fail(err);
        }
        function onup1(err)
        {
            if (!err)
            {
                success();
                return;
            }
            
            if (err.code === 553)
            {
                var ftpdir = ftppath.substr(0, ftppath.lastIndexOf("/") + 1);
                if (ftpdir)
                {
                    client.mkdir(ftpdir, true, function(err){
                        if (err) fail(err);
                        else client.put(localpath, ftppath, onup2);
                    });
                    return;
                }
            }
            fail(err);
        }

        client.put(localpath, ftppath, onup1);
    });
}

/**
 * @param {string} localpath
 * @param {string} workpath
 * @returns {Promise}
 */
function _download(localpath, workpath)
{
    cancelDestroyTimeout();
    return new Promise(function(resolve, reject)
    {
        util.setState("download "+workpath);
        util.log("download: "+workpath);
        var ftppath = toftpPath(workpath);

        function success()
        {
            util.setState("");
            updateDestroyTimeout();
            resolve();
        }
        function fail(err)
        {
            util.setState("");
            updateDestroyTimeout();
            util.log("download fail: "+workpath);
            reject(_errorWrap(err));
        }
        client.get(ftppath, function(err, stream) {
            if(err) return fail(err);
            stream.once('close', success);
            stream.pipe(ofs.createWriteStream(localpath));
        });
    });
}

/**
 * @param {string} workpath
 * @returns {Promise}
 */
function _list(workpath)
{
    cancelDestroyTimeout();
    return new Promise(function(resolve, reject)
    {
        util.setState("list "+workpath);
        util.log("list: "+workpath);
        var ftppath = toftpPath(workpath);
        if (!ftppath) ftppath = ".";

        client.list(ftppath, false, function(err, list){
            util.setState("");
            updateDestroyTimeout();
            if (err)
            {
                util.log("list fail: "+workpath);
                reject(_errorWrap(err));
                return;
            }
            var errfiles = [];
            for (var i = 0; i<list.length; i++)
            {
                var file = list[i];
                var fn = file.name = bin2str(file.name);
                if (!config.ignoreWrongFileEncoding)
                {
                    if (fn.indexOf('�') !== -1 || fn.indexOf('?') !== -1)
                        errfiles.push(fn);
                }
            }
            if (errfiles.length)
            {
                util.errorConfirm("Invalid encoding detected. Please set fileNameEncoding correctly\n"+errfiles.join('\n'), 'Open config', 'Ignore after')
                .then(function(res){
                    switch(res)
                    {
                    case 'Open config': util.open(config.PATH); break; 
                    case 'Ignore after': config.ignoreWrongFileEncoding = true; break;
                    }
                });
            }
            resolve(list);
        });
    });
}

var destroyTimeout = 0;

function cancelDestroyTimeout()
{
    if (destroyTimeout === 0)
        return;

    clearTimeout(destroyTimeout);
    destroyTimeout = 0;
}

function updateDestroyTimeout()
{
    if (!client)
        return;
    cancelDestroyTimeout();
    destroyTimeout = setTimeout(destroy, 5000);
}

function destroy()
{
    destroyTimeout = 0;
    if (client)
    {
        client.end();
        client = null;
    }
}

module.exports = {
    /**
     * @param {string} workpath
     * @returns {!Promise}
     */
    rmdir: function(workpath)
    {
       return init().then(() => _rmdir(workpath));
    },
    /**
     * @param {string} workpath
     * @returns {!Promise}
     */
    delete: function(workpath)
    {
       return init().then(() => _delete(workpath));
    },
    /**
     * @param {string} workpath
     * @returns {!Promise}
     */
    mkdir: function(workpath)
    {
       return init().then(() => _mkdir(workpath));
    },
    /**
     * @param {string} workpath
     * @param {string} localpath
     * @returns {!Promise}
     */
    upload: function(workpath, localpath)
    {
       return init().then(() => _upload(workpath, localpath));
    },
    /**
     * @param {string} localpath
     * @param {string} workpath
     * @returns {!Promise}
     */
    download: function(localpath, workpath)
    {
       return init().then(() => _download(localpath, workpath));
    },
    /**
     * @param {string} workpath
     * @returns {!Promise}
     */
    list: function(workpath)
    {
       return init().then(() => _list(workpath));
    }
};