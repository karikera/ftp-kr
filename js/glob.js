
var glob_inner = require("glob");
var util = require("./util");

/**
 * @param {string} pattern
 * @returns {Promise}
 */
function glob(pattern)
{
    pattern = pattern.replace(/\\/g, "/");
    return new Promise(function(resolve, reject){
        glob_inner(pattern, null, function(err, files){ 
            if (err) reject(err);
            else resolve(files);
        });
    });
}

/**
 * @param {Array.<string>} pattern
 * @returns {Promise}
 */
function globAll(files)
{
    return util.cascadingPromise(glob, files)
    .then((fileses) => Array.prototype.concat.apply([], fileses));
}

/**
 * @param {string} pattern
 * @returns {Array.<string>}
 */
module.exports = function(pattern)
{
    if (pattern instanceof Array)
        return globAll(pattern);
    return glob(pattern);
};
