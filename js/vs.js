
var reader = require("./reader");
var fs = require("fs");
var path = require("path");

var vs = {};

function Includer()
{
    this.included = {};
    this.including = {};
    this.list = [];
    this.errors = [];
}

Includer.prototype.included = null;
Includer.prototype.including = null;
Includer.prototype.list = null;
Includer.prototype.errors = null;

/**
 * @param {string|Array.<string>} src
 * @returns {void}
 */
Includer.prototype.include = function(src)
{
    if (src instanceof Array)
    {
        for (var i=0;i<src.length;i++)
        {
            this.include(src[i]);
        }
        return;
    }
    if (src in this.included)
        return;
    if (src in this.including)
        throw Error("SELF_INCLUDE");
    this.included[src] = true;
    this.including[src] = true;

    try
    {
        /** @type {string} */
        var data = fs.readFileSync(src, "utf8");
    }
    catch(e)
    {
        throw Error("FILE_NOT_FOUND");
    }
    /** @type {Array.<reader.Tag>} */
    var arr = vs.readXml(data);

    var dir = src.substr(0, src.lastIndexOf("/")+ 1);
    for (var i=0;i<arr.length;i++)
    {
        var tag = arr[i];
        switch (tag.name)
        {
        case "reference":
            var file = path.normalize(dir + tag.props.path).replace(/\\/g, "/");
            try
            {
                this.include(file);
            }
            catch(e)
            {
                switch(e.message)
                {
                case "SELF_INCLUDE":
                    this.errors.push([src, tag.lineNumber, e.message]);
                    break;
                case "FILE_NOT_FOUND":
                    this.errors.push([src, tag.lineNumber, "File not found: "+path.resolve(file)]);
                    break;
                default: throw e;
                }
            }
            break;
        }
    }
    this.list.push(src);
};

vs.readXml = function(data)
{
    var page = new reader.Reader;
    page.data = data;

    var lineNumber = 0;

    var line = new reader.Reader;

    var out = [];
    for(;;)
    {
        page.skipSpace();
        if (!page.startsWith("///")) break;
        
        lineNumber++;
        line.i = 0;
        line.data = page.readTo("\n");
        var close = line.data.lastIndexOf("/>");
        if (close === -1) continue;
        line.data = line.data.substr(0, close);

        line.skipSpace();
        if (!line.startsWith("<")) continue;
        out.push(new reader.Tag(line, lineNumber));
    }
    return out;
};


/**
 * @param {Array.<string>}
 * @returns {Array.<string>}
 */
vs.normalize = function(src)
{
    var sort = {};
    var j = 0;
    for(var i=0;i<src.length;i++)
    {
        var s = path.resolve(src[i]);
        if (s in sort)
            continue;
        sort[s] = j++;
    }
    var out = [];
    for (var p in sort)
        out[p | 0] = p;
    return out;
};

vs.Includer = Includer;

module.exports = vs;
