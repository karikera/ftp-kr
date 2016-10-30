
var vscode = require("vscode");
var fs = require('./fs');
var window = vscode.window;
var workspace = vscode.workspace;

var output = null;
var statebar = null;


function Deferred()
{
    var that = this;
    this.promise = new Promise(function(res, rej){
        that.resolve = res;
        that.reject = rej;
    });
}

/** @type{Promise} */
Deferred.prototype.promise = null;
/** @type {function()} */
Deferred.prototype.resolve = null;
/** @type {function()} */
Deferred.prototype.reject = null;
/**
 * @param {function()} func
 * @return {!Promise}
 */
Deferred.prototype.then = function(func)
{
    return this.promise.then(func);
};
/**
 * @param {function()} func
 * @return {!Promise}
 */
Deferred.prototype.catch = function(func)
{
    return this.promise.catch(func);
};


var util = {
    Deferred: Deferred,

    /**
     * @return {boolean}
     */
    isEmptyObject: function(obj)
    {
        for(var p in obj) return false;
        return true;
    },

    /**
     * @param {string} state
     * @return {void}
     */
    setState: function(state)
    {
        if (!statebar) statebar = window.createStatusBarItem();
        statebar.text = state;
        statebar.show();  
    },

    /**
     * @returns {void}
     */
    clearLog:function()
    {
        if (!output)
            return;
        output.clear();
    },
    /**
     * @param {...string} message
     * @returns {void}
     */
    log: function(message)
    {
        if (!output)
        {
            output = window.createOutputChannel("ftp-kr");
        }
        output.appendLine.apply(output, arguments);
    },

    /**
     * @function
     * @param {function()} func
     * @returns {void}
     */
    wrap: function(func)
    {
        try
        {
            func();
        }
        catch(err)
        {
            util.error(err);
        }
    },
    /**
     * @function
     * @param {string} info
     * @param {...string} items
     * @returns {!Promise}
     */
    info: function (info, items)
    {
        return window.showInformationMessage.apply(window, arguments);
    },
    /**
     * @function
     * @param {Error|string} err
     * @returns {void}
     */
    error: function (err)
    {
        console.error(err);
        util.log(err);
        window.showErrorMessage(err instanceof Error ? err.message : err.toString());
    },
    /**
     * @function
     * @param {Error|string} err
     * @param {...string} items
     * @returns {void}
     */
    errorConfirm: function (err, items)
    {
        var args = Array.prototype.slice.apply(arguments);
        if (err instanceof Error)
            args[0] = err.message;
        else
            err = new Error(err);
        console.error(err);
        util.log(err);
        return window.showErrorMessage.apply(window, args);
    },
    /**
     * @function
     * @param {string} path
     * @param {string} message
     * @returns {!Promise}
     */
    openWithError: function(path, message)
    {
        window.showErrorMessage(path + ": " + message);
        return util.open(path);
    },
    /**
     * @function
     * @param {string} path
     * @returns {!Promise}
     */
    open: function(path)
    {
       return workspace.openTextDocument(fs.workspace + path)
        .then((doc) => window.showTextDocument(doc));
    },

    /**
     * @function
     * @template T
     * @param {function(Array.<T>):Promise} func
     * @param {Array.<T>} params
     * @returns {Promise}
     */
    cascadingPromise: function(func, params)
    {
        if (params.length == 0)
        {
            return Promise.resolve([]);
        }
        var response = [];
        var promise = func(params[0]);
        
        function make(param)
        {
            return function(res){
                response.push(res);
                return func(param);
            };
        }
        for (var i=1;i<params.length;i++)
        {
            promise = promise.then(make(params[i]));
        }
        return promise.then(function(res){
            response.push(res);
            return response;
        }).catch((err) => { return Promise.reject(err); }); /// This is fix freeze error, I can't understand
    },

    /**
     * @function
     * @param {function(Array.<?>):Promise} func
     * @param {Array.<?>} params
     * @returns {!Promise}
     */
    ascadingPromiseAuto: function(func, params)
    {
        if (!("length" in params))
        {
            params = [params];
        }
        else if (params.length === 1 && params[0] instanceof Array)
        {
            params = params[0];
        }
        var response = [];
        var promise = func(params[0]);
        
        function make(param)
        {
            return function(res){
                response.push(res);
                return func(param);
            };
        }
        for (var i=1;i<params.length;i++)
        {
            promise = promise.then(make(params[i]));
        }
        return promise.then(function(res){
            if (response.length === 0)
                return res;
            response.push(res);
            return response;
        });
    },
    /**
     * @function
     * @param {Array.<string>} args
     * @param {Object} options
     * @returns {void}
     */
    addOptions: function(args, options)
    {
        Object.keys(options).forEach(function(key) {
            var i, len, val, value;
            value = options[key];
            if (Array.isArray(value)) {
                for (i = 0, len = value.length; i < len; i++) {
                val = value[i];
                args.push("--" + key);
                args.push(val);
                }
                return;
            }
            if (typeof value === 'boolean' && value === false) {
                return;
            }
            args.push("--" + key);
            if (value !== true) {
                return args.push(value);
            }
        });
    }
};

module.exports = util; 