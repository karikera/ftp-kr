
function Reader()
{
}

Reader.prototype.i = 0;
Reader.prototype.data = "";

Reader.prototype.startsWith = function(str)
{
    if (this.data.substr(this.i, str.length) !== str)
        return false;
    this.i += str.length;
    return true;
};

Reader.prototype.startsWithList = function(strs)
{
    for(var i=0;i<strs.length;i++)
    {
        if (this.startsWith(strs[i]))
            return strs[i];
    }
    return "";
}
Reader.prototype.peek = function()
{
    return this.data.charAt(this.i);
};

Reader.prototype.skipSpace = function()
{
    for(;;) switch (this.peek())
    {
    case " ": case "\r": case "\n": case "\t": this.i++; break;
    default: return;
    }
};
Reader.prototype.readTo = function(chr)
{
    if (chr instanceof RegExp)
    {
        var nidx = this.data.substr(this.i).search(chr);
        if (nidx === -1)
            return null;
        var out = this.data.substr(this.i, nidx);
        this.i = this.i + nidx + RegExp.lastMatch.length;
        return out;
    }
    var nidx = this.data.indexOf(chr, this.i);
    if (nidx === -1)
        return null;
    var out = this.data.substring(this.i, nidx);
    this.i = nidx + chr.length;
    return out;
};
Reader.prototype.space = function()
{
    switch (chr())
    {
    case " ": case "\r": case "\n": case "\t":
        this.i++;
        this.skipSpace();
        return true;
    default:
        return false;
    }
};
Reader.prototype.readLeft = function()
{
    var out = this.data.substr(this.i);
    this.i = this.data.length;
    return out;
};

function Tag(line, lineNumber)
{
    this.props = {};
    if (lineNumber)
        this.lineNumber = lineNumber;

    var tagname = line.readTo(/[ \t]/);
    if (tagname === null)
    {
        this.name = line.readLeft();
        return;
    }

    this.name = tagname;
    for(;;)
    {
        line.skipSpace();
        var prop = line.readTo("=");
        if (prop === null)
            break;
        line.skipSpace();

        var start = line.startsWithList(["'", '"']);
        this.props[prop] = line.readTo(start);
    }
}

Tag.prototype.name = "";
Tag.prototype.props = null;
Tag.prototype.lineNumber = 0;

module.exports = {"Reader": Reader, "Tag": Tag};
