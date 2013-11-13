/**
 * aws - deploys "earth" files to AWS S3
 */

"use strict";

var util = require("util");
var fs = require("fs");
var when = require("when");
var apply = require("when/apply");
var tool = require(__dirname + "/tool");
var AWS = require("aws-sdk");

AWS.config.loadFromPath("./scratch/aws-config.json");
var s3 = new AWS.S3();

exports.headObject = function(params) {
    var d = when.defer();
    s3.client.headObject(params, function(error, data) {
        return error ? error.statusCode !== 404 ? d.reject(error) : d.resolve(error) : d.resolve(data);
    });
    return d.promise;
}; var headObject = exports.headObject;

function putObject(params, expectedETag) {
    var d = when.defer();
    s3.client.putObject(params, function(error, data) {
        if (error) {
            return d.reject(error);
        }
        if (expectedETag && data.ETag.replace(/"/g, "") !== expectedETag) {
            return d.reject({expected: expectedETag, data: data});
        }
        delete params.Body;
        return d.resolve({putObject: params, response: data});
    });
    return d.promise;
}

exports.uploadFile = function(path, bucket, key) {

    var meta = headObject({Bucket: bucket, Key: key});
    var options = {
        Bucket: bucket,
        Key: key,
        ContentType: tool.contentType(path),
        CacheControl: tool.cacheControl(key)
    };

    if (tool.isCompressionRequired(options.ContentType)) {
        options.ContentEncoding = "gzip";
        path = tool.compress(fs.createReadStream(path));
    }

    var md5 = when(path).then(function(path) { return tool.hash(fs.createReadStream(path)); });

    return when.all([meta, path, md5]).then(apply(function(meta, path, md5) {

        if (meta.statusCode !== 404 &&
            meta.ContentLength * 1 === fs.statSync(path).size &&
            meta.ETag.replace(/"/g, "") === md5 &&
            meta.ContentType === options.ContentType &&
            meta.CacheControl === options.CacheControl) {

            return {unchanged: meta};
        }

        options.Body = fs.createReadStream(path);
        return putObject(options, md5);

    }));
};
