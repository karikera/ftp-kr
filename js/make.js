
var util = require("./util");
var fs = require("fs");

function MakeFile()
{
    this.map = {};
}

MakeFile.prototype.map = null;
MakeFile.prototype.on = function(master, childs, callback)
{
    this.map[master] = [childs, callback];
};
MakeFile.prototype.make = function(target)
{
    function buildChild(child)
    {
        return that.make(child).then(function(mod){
            modified = modified || mod;
            if (!modified)
            {
                try
                {
                    if(!mtime)
                        mtime = fs.statSync(target).mtime.valueOf();
                } 
                catch (error)
                {
                    mtime = -1;
                }
                    
                if (mtime <= fs.statSync(child).mtime.valueOf())
                    modified = true;
            }
        });
    }

    var that = this;
    var mtime = 0;
    var options = this.map[target];
    if (!options)
        return Promise.resolve(false);

    var children = options[0];
    if (children.length === 0)
        return options[1]();

    var modified = false;        
    return util.cascadingPromise(buildChild, children).then(function(){
        if (modified)
            return options[1]();
        return Promise.resolve("LATEST");
    });
};

module.exports = MakeFile;
