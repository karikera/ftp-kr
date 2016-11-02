
var config = require('../config');
var work = require('../work');
var util = require('../util');

function makeEvent()
{
    var list = [];
    function ev(onfunc)
    {
        list.push(onfunc);
    }
    ev.fire = function()
    {
        var promise = Promise.resolve();
        for(let func of list)
            promise = promise.then(() => func());
        return promise;
    };
    ev.rfire = function()
    {
        var promise = Promise.resolve();
        for(var i = list.length -1 ; i>= 0; i--)
        {
            let func = list[i];
            promise = promise.then(() => func());
        }
        return promise;
    };
    return ev;
}

function fireNotFound()
{
    if (config.state === "NOTFOUND")
        return Promise.resolve();

    config.state = "NOTFOUND";
    return cfg.onNotFound.rfire();
}

function fireInvalid()
{
    if (config.state === "INVALID")
        return Promise.resolve();

    config.state = "INVALID";
    return cfg.onInvalid.fire();
}

function fireLoad()
{
    return cfg.onLoad.fire()
    .then(function(){
        util.log("ftp-kr.json: loaded");
        config.state = "LOADED";
    })
    .catch(function(err){
        util.error(err);
        util.open(config.PATH);
        return Promise.reject("INVALID");
    });
}

function onLoadError(err)
{
    switch (err)
    {
    case "NOTFOUND":
        util.log("ftp-kr.json: not found");
        return fireNotFound();
    case "INVALID":
        util.log("ftp-kr.json: invalid");
        return fireInvalid();
    default:
        util.error(err);
        return;
    }
}


var cfg = module.exports = {
    loadTest: function()
    {
        if (config.state !== 'LOADED')
        {
            util.open(config.PATH);
            return Promise.reject(new Error("Need to fix"));
        } 
        return Promise.resolve();
    },
    load: function()
    {
        return work.compile.add(
            ()=>work.ftp.add(
                ()=> work.load.add(
                    ()=>config.load().then(fireLoad)
                ).end()
            ).end()
        ).catch((err) => onLoadError(err));
    },

    unload: function()
    {
    },

    onLoad:makeEvent(),
    onInvalid:makeEvent(),
    onNotFound:makeEvent(),

    commands: {
        'ftpkr.init': function(){
            return work.compile.add(
                ()=>work.ftp.add(
                    ()=> work.load.add(
                        ()=>config.init().then(fireLoad)
                    ).end()
                ).end()
            ).catch((err) => onLoadError(err));
        }
    }
};