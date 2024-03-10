/* streaming storage to an S3-compatible service */

/* eslint-env node */
/* eslint-disable camelcase */
const express = require('express');
const { posix } = require('node:path');
const { HeadObjectCommand, S3Client, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const normalizeETag = require('../util/normalizeETag');
const ParameterError = require('../util/ParameterError');
const { dirname, basename } = require('path');
const YAML = require('yaml');
const TimeoutError = require('../util/timeoutError');
const { Upload } = require('@aws-sdk/lib-storage');
const { pipeline } = require('node:stream/promises');

const PUT_TIMEOUT = 24 * 60 * 60 * 1000;
// const AUTH_PREFIX = 'remoteStorageAuth';
// const AUTHENTICATION_LOCAL_PASSWORD = 'authenticationLocalPassword';
// const USER_METADATA = 'userMetadata';
const FILE_PREFIX = 'remoteStorageBlob';
const EMPTY_DIRECTORY = { '@context': 'http://remotestorage.io/spec/folder-description', items: {} };

module.exports = function (endPoint = 'play.min.io', accessKey = 'Q3AM3UQ867SPQQA43P2F', secretKey = 'zuf+tfteSlswRu7BJ86wekitnifILbZam1KYY3TG', region = 'us-east-1') {
  const sslEnabled = !/\blocalhost\b|\b127.0.0.1\b|\b10.0.0.2\b/.test(endPoint);
  if (!endPoint.startsWith('http')) {
    endPoint = (sslEnabled ? 'https://' : 'http://') + endPoint;
  }
  // if (!/:\d{1,5}\/?$/.test(endPoint)) {
  //   endPoint += ':9000';
  // }

  const s3client = new S3Client({
    forcePathStyle: true,
    region,
    endpoint: endPoint,
    sslEnabled,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      Version: 1
    }
    // logger: getLogger(),
  });

  const router = express.Router();
  router.get('/:username/*',
    async function (req, res, next) {
      try {
        const bucketName = req.params.username.toLowerCase();
        const isDirectoryRequest = req.url.endsWith('/');
        const s3Path = posix.join(FILE_PREFIX, isDirectoryRequest ? req.params[0].slice(0, -1) : req.params[0]);
        let getParam;
        if (req.get('If-None-Match')) {
          getParam = { Bucket: bucketName, Key: s3Path, IfNoneMatch: req.get('If-None-Match') };
        } else if (req.get('If-Match')) {
          getParam = { Bucket: bucketName, Key: s3Path, IfMatch: req.get('If-Match') };
        } else { // unconditional
          getParam = { Bucket: bucketName, Key: s3Path };
        }

        const { Body, ETag, ContentType, ContentLength } = await s3client.send(new GetObjectCommand(getParam));
        const isDirectory = ContentType === 'application/x.remotestorage-ld+json';
        const contentType = isDirectory ? 'application/ld+json' : ContentType;
        if (isDirectoryRequest ^ isDirectory) {
          return res.status(409).end(); // Conflict
          // return { status: 409, readStream: null, contentType, contentLength: null, ETag: null }; // Conflict
        } else {
          res.status(200).set('Content-Length', ContentLength).set('Content-Type', contentType).set('ETag', normalizeETag(ETag));
          return pipeline(Body, res);
        }
      } catch (err) {
        if (['NotFound', 'NoSuchKey'].includes(err.name)) {
          return res.status(404).end(); // Not Found
          // return next(Object.assign(new Error(`No file exists at path “${req.blobPath}”`), { status: 404 }));
        } else if (err.name === 'PreconditionFailed') {
          return res.status(412).end();
          // return { status: 412 };
        } else if (err.name === 'NotModified' || err.$metadata?.httpStatusCode === 304 || err.name === 304) {
          return res.status(304).end();
        } else {
          return next(Object.assign(err, { status: 502 }));
        }
      }
    }
  );

  router.put('/:username/*',
    async function (req, res, next) {
      try {
        if (req.url.length === 0 || /\/\/|(^|\/)\.($|\/)|(^|\/)\.\.($|\/)|\0/.test(req.url)) {
          next(Object.assign(new ParameterError('A parameter value is bad'), { status: 400 })); return;
        }
        if (req.url.endsWith('/')) {
          res.status(409).end(); return;
        }
        const bucketName = req.params.username.toLowerCase();
        const s3Path = posix.join(FILE_PREFIX, req.params[0]);
        let currentETag;
        try {
          const headResponse = await s3client.send(new HeadObjectCommand({ Bucket: bucketName, Key: s3Path }));
          if (headResponse.ContentType === 'application/x.remotestorage-ld+json') {
            res.status(409).end(); return;
          }
          currentETag = normalizeETag(headResponse.ETag);
        } catch (err) {
          if (err.$metadata?.httpStatusCode === 400 || err.name === '400') {
            return next(Object.assign(new ParameterError('A parameter value is bad', { cause: err }), { status: 400 }));
          } else if (!['NotFound', 'NoSuchKey'].includes(err.name)) {
            return next(Object.assign(err, { status: 502 }));
          }
        }

        // validates that each ancestor folder is a folder or doesn't exist
        let ancestorPath = dirname(s3Path);
        do {
          try {
            const { ContentType } = await s3client.send(new HeadObjectCommand({ Bucket: bucketName, Key: ancestorPath }));
            if (ContentType !== 'application/x.remotestorage-ld+json') {
              res.status(409).end(); return; // Conflict
            }
          } catch (err) {
            if (!['NotFound', 'NoSuchKey'].includes(err.name)) {
              next(Object.assign(err, { status: 502 })); return;
            }
          }
          ancestorPath = dirname(ancestorPath);
        } while (ancestorPath.length >= FILE_PREFIX.length);

        if (req.get('If-None-Match') === '*' && currentETag) {
          res.status(412).end(); return;
        } else if (req.get('If-None-Match') && req.get('If-None-Match') === currentETag) {
          res.status(412).end(); return;
        } else if (req.get('If-Match') && req.get('If-Match') !== currentETag) {
          res.status(412).end(); return;
        } // else unconditional

        const contentLength = parseInt(req.get('Content-Length')) ? parseInt(req.get('Content-Length')) : undefined;
        const contentType = req.get('Content-Type') || 'application/binary';
        const putETag = await putBlob(bucketName, s3Path, contentType, contentLength, req);

        // updates all ancestor directories
        let metadata = {
          ETag: putETag,
          'Content-Type': contentType,
          ...(contentLength >= 0 ? { 'Content-Length': contentLength } : null),
          'Last-Modified': new Date().toUTCString()
        };
        let itemPath = s3Path;
        do {
          let directory;
          try {
            directory = await readJson(bucketName, dirname(itemPath));
          } catch (err) {
            if (!['NotFound', 'NoSuchKey'].includes(err.name)) {
              return next(Object.assign(err, { status: 502 }));
            }
          }
          if (!(directory?.items instanceof Object)) {
            directory = structuredClone(EMPTY_DIRECTORY);
          }
          if (typeof metadata === 'object') {
            directory.items[basename(itemPath)] = metadata;
          } else { // item is folder
            directory.items[basename(itemPath) + '/'] = { ETag: metadata };
          }
          const dirJSON = JSON.stringify(directory);
          const folderETag = await putBlob(bucketName, dirname(itemPath), 'application/x.remotestorage-ld+json', dirJSON.length, dirJSON);

          metadata = normalizeETag(folderETag);
          itemPath = dirname(itemPath);
        } while (itemPath.length > FILE_PREFIX.length);

        return res.status(currentETag ? 200 : 201).set('ETag', putETag).end();
      } catch (err) {
        if (err.name === 'TimeoutError') {
          return res.status(504).end();
        } else if (err.$metadata?.httpStatusCode === 400 || err.name === '400' || err.name === 'NoSuchBucket') {
          return next(Object.assign(new ParameterError('A parameter value is bad', { cause: err }), { status: 400 }));
        } else {
          return next(Object.assign(err, { status: 502 }));
        }
      }
    });

  router.delete('/:username/*',
    async function (req, res, next) {
      try {
        const bucketName = req.params.username.toLowerCase();
        const s3Path = posix.join(FILE_PREFIX, req.url.slice(1 + bucketName.length));
        let currentETag;
        try {
          const headResponse = await s3client.send(new HeadObjectCommand({ Bucket: bucketName, Key: s3Path }));
          if (headResponse.ContentType === 'application/x.remotestorage-ld+json') {
            return res.status(409).end();
          }
          currentETag = normalizeETag(headResponse.ETag);

          if (req.get('If-Match') && req.get('If-Match') !== currentETag) {
            return res.status(412).end();
          } else if (req.get('If-None-Match') && req.get('If-None-Match') === currentETag) {
            return res.status(412).end();
          }
          /* const { DeleteMarker, VersionId } = */ await s3client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: s3Path }));
        } catch (err) {
          if (['NotFound', 'NoSuchKey'].includes(err.name)) {
            return res.status(404).end();
          } else if (err.$metadata?.httpStatusCode === 400 || err.name === '400' || /\bBucket\b/.test(err.message)) {
            return next(Object.assign(new ParameterError('A parameter value is bad', { cause: err }), { status: 400 }));
          } else {
            return next(Object.assign(err, { status: 502 }));
          }
        }

        // updates all ancestor directories
        let itemETag = null;
        let itemPath = s3Path;
        do {
          let directory;
          try {
            directory = await readJson(bucketName, dirname(itemPath));
          } catch (err) {
            if (!['NotFound', 'NoSuchKey'].includes(err.name)) { return next(Object.assign(err, { status: 502 })); }
          }
          if (!(directory?.items instanceof Object)) {
            directory = structuredClone(EMPTY_DIRECTORY);
            // TODO: scan for existing blobs
          }
          if (typeof itemETag === 'string') { // item is folder
            if (itemETag.length > 0) {
              directory.items[basename(itemPath) + '/'] = { ETag: itemETag };
            } else {
              delete directory.items[basename(itemPath) + '/'];
            }
          } else {
            delete directory.items[basename(itemPath)];
          }
          if (Array.from(Object.keys(directory.items)).length > 0) {
            const dirJSON = JSON.stringify(directory);
            const folderETag = await putBlob(bucketName, dirname(itemPath), 'application/x.remotestorage-ld+json', dirJSON.length, dirJSON);

            itemETag = normalizeETag(folderETag);
          } else { // that was the last blob in the folder, so delete the folder
            /* const { DeleteMarker, VersionId } = */ await s3client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: dirname(itemPath) }));
            itemETag = '';
          }

          itemPath = dirname(itemPath);
        } while (itemPath.length > FILE_PREFIX.length);

        if (currentETag) {
          res.set('ETag', normalizeETag(currentETag));
        }
        res.status(204).end();
      } catch (err) {
        if (err.$metadata?.httpStatusCode === 400 || err.name === '400') {
          return next(Object.assign(new ParameterError('A parameter value is bad', { cause: err }), { status: 400 }));
        } else {
          return next(Object.assign(err, { status: 502 }));
        }
      }
    }
  );

  async function putBlob (bucketName, s3Path, contentType, contentLength, contentStream) {
    if (contentLength <= 500_000_000) {
      const putPrms = s3client.send(new PutObjectCommand(
        { Bucket: bucketName, Key: s3Path, Body: contentStream, ContentType: contentType, ContentLength: contentLength }));
      const timeoutPrms = new Promise((_resolve, reject) =>
        setTimeout(reject, PUT_TIMEOUT, new TimeoutError(`PUT of ${contentLength / 1_000_000} MB to ${bucketName} ${s3Path} took more than ${Math.round(PUT_TIMEOUT / 60_000)} minutes`)));
      const putResponse = await Promise.race([putPrms, timeoutPrms]);
      return normalizeETag(putResponse.ETag);
    } else {
      const parallelUpload = new Upload({
        client: s3client,
        params: { Bucket: bucketName, Key: s3Path, Body: contentStream, ContentType: contentType, ContentLength: contentLength }
      });

      parallelUpload.on('httpUploadProgress', (progress) => {
        console.debug(bucketName, s3Path, `part ${progress.part}   ${progress.loaded} / ${progress.total} bytes`);
      });

      return normalizeETag((await parallelUpload.done()).ETag);
    }
  }

  async function readYaml (bucketName, s3Path) { // eslint-disable-line no-unused-vars
    const { Body } = await s3client.send(new GetObjectCommand({ Bucket: bucketName, Key: s3Path }));
    const string = (await Body.setEncoding('utf-8').toArray())[0];
    return YAML.parse(string);
  }

  async function readJson (bucketName, s3Path) {
    const { Body } = await s3client.send(new GetObjectCommand({ Bucket: bucketName, Key: s3Path }));
    const string = (await Body.setEncoding('utf-8').toArray())[0];
    return JSON.parse(string);
  }

  return router;
};
