/* streaming storage to an S3-compatible service */

/* eslint-env node */
/* eslint-disable camelcase */
const express = require('express');
const { posix } = require('node:path');
const {
  HeadObjectCommand, S3Client, DeleteObjectCommand, GetObjectCommand, PutObjectCommand,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  ListObjectVersionsCommand,
  DeleteBucketCommand, GetBucketVersioningCommand, ListBucketsCommand
} = require('@aws-sdk/client-s3');
const normalizeETag = require('../util/normalizeETag');
const ParameterError = require('../util/ParameterError');
const { dirname, basename } = require('path');
const YAML = require('yaml');
const TimeoutError = require('../util/timeoutError');
const { Upload } = require('@aws-sdk/lib-storage');
const { pipeline } = require('node:stream/promises');
const core = require('../stores/core');
const { getLogger } = require('../logger');

const PUT_TIMEOUT = 24 * 60 * 60 * 1000;
const AUTH_PREFIX = 'remoteStorageAuth';
const AUTHENTICATION_LOCAL_PASSWORD = 'authenticationLocalPassword';
const USER_METADATA = 'userMetadata';
const FILE_PREFIX = 'remoteStorageBlob';
const EMPTY_DIRECTORY = { '@context': 'http://remotestorage.io/spec/folder-description', items: {} };

/**
 * A factory to create a handler for S3-compatible storage. Buckets may be shared with other apps.
 * @param {string} endPoint the protocol and hostname, and optionally the port
 * @param {string} accessKey effectively the admin user account name
 * @param {string} secretKey
 * @param {string} region only required for AWS
 * @param {string} userNameSuffix required for AWS and other shared namespaces
 * @returns {Router}
 */
module.exports = function (endPoint = 'play.min.io', accessKey = 'Q3AM3UQ867SPQQA43P2F', secretKey = 'zuf+tfteSlswRu7BJ86wekitnifILbZam1KYY3TG', region = 'us-east-1', userNameSuffix = '') {
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
  s3client.send(new ListBucketsCommand({})).then(({ Buckets }) => {
    const users = [];
    let numOtherBuckets = 0;
    for (const bucket of Buckets) {
      if (bucket.Name.endsWith(userNameSuffix)) {
        users.push(bucket.Name.slice(0, -userNameSuffix.length));
      } else {
        ++numOtherBuckets;
      }
    }
    getLogger().info(`${endPoint} ${accessKey} has ${users.length} users: ` + users.join(', '));
    getLogger().info(`${endPoint} ${accessKey} has ${numOtherBuckets} buckets that are not accounts (don't end with “${userNameSuffix}”)`);
  }).catch(err => { // it's really bad if storage can't be reached
    getLogger().alert('while listing buckets:', err);
  });

  const router = express.Router();
  router.get('/:username/*',
    async function (req, res, next) {
      try {
        const bucketName = calcBucketName(req.params.username);
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
        const bucketName = calcBucketName(req.params.username);
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
        const bucketName = calcBucketName(req.params.username);
        const s3Path = posix.join(FILE_PREFIX, req.params[0]);
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

  /**
   * Creates a versioned bucket with authentication & version data for the new user.
   * @param {Object} params
   * @param {string} params.username
   * @param {string} params.email
   * @param {string} params.password
   * @returns {Promise<string>} name of bucket
   */
  router.createUser = async function createUser (params) {
    const { username, email, password } = params;
    const bucketName = calcBucketName(username);

    const errors = core.validateUser(params);
    if (errors.length > 0) {
      const msg = errors.map(err => err.message).join('|');
      throw new Error(msg);
    }

    try {
      await s3client.send(new GetBucketVersioningCommand({ Bucket: bucketName }));
      throw new Error(`Username “${username}” is already taken`);
    } catch (err) {
      if (err.name !== 'NoSuchBucket') {
        throw err;
      } // else bucket doesn't exist, thus the name is available for the new user
    }

    try {
      await s3client.send(new CreateBucketCommand({ Bucket: bucketName }));

      await s3client.send(new PutBucketVersioningCommand({
        Bucket: bucketName,
        VersioningConfiguration: { Status: 'Enabled' }
      }));

      const config = await core.hashPassword(password, null);

      const hashedPasswordBlobPath = posix.join(AUTH_PREFIX, AUTHENTICATION_LOCAL_PASSWORD);
      await s3client.send(new PutObjectCommand({ Bucket: bucketName, Key: hashedPasswordBlobPath, Body: YAML.stringify(config), ContentType: 'application/yaml' }));

      const metadata = { email };
      const metadataPath = posix.join(AUTH_PREFIX, USER_METADATA);
      await s3client.send(new PutObjectCommand({ Bucket: bucketName, Key: metadataPath, Body: YAML.stringify(metadata), ContentType: 'application/yaml' }));

      // TODO: delete older versions
      return bucketName;
    } catch (err) {
      if (err.name === 'BucketAlreadyOwnedByYou') {
        throw new Error(`Username “${username}” is already taken`, { cause: err });
      } else {
        getLogger().error('while creating bucket or writing initial blobs', err);
        throw new Error('while creating bucket or writing initial blobs: ' + err, { cause: err });
      }
    }
  };

  /**
   * Deletes all of user's files and the bucket. NOT REVERSIBLE.
   * @param username
   * @returns {Promise<number>} number of files deleted
   */
  router.deleteUser = async function deleteUser (username) {
    let numObjectsDeleted = 0;
    let numObjectsFailedToDelete = 0;

    const promise = new Promise((resolve, reject) => {
      const bucketName = calcBucketName(username);

      const deleteItems = async items => {
        for (const item of items) {
          try {
            /* const { DeleteMarker } = */ await s3client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: item.Key, VersionId: item.VersionId }));
            // console.log(`deleted ${item.Key} ${DeleteMarker}`);
            ++numObjectsDeleted;
          } catch (err) {
            console.warn('while deleting', bucketName, item.Key, item.VersionId);
            ++numObjectsFailedToDelete;
          }
        }
      };

      const pageObjectVersions = async (KeyMarker) => {
        try {
          const { Versions, DeleteMarkers, IsTruncated, NextKeyMarker } = await s3client.send(new ListObjectVersionsCommand({ Bucket: bucketName, ...(KeyMarker ? { KeyMarker } : null) }));

          if (typeof Versions?.[Symbol.iterator] === 'function') {
            await deleteItems(Versions);
          }
          if (typeof DeleteMarkers?.[Symbol.iterator] === 'function') {
            await deleteItems(DeleteMarkers);
          }

          if (IsTruncated) {
            return pageObjectVersions(NextKeyMarker).catch(reject);
          } else {
            await s3client.send(new DeleteBucketCommand({ Bucket: username }));
            resolve([numObjectsDeleted, numObjectsFailedToDelete]);
          }
        } catch (err) {
          if (err.name === 'NoSuchBucket') {
            resolve();
          } else {
            reject(err);
          }
        }
      };

      pageObjectVersions(undefined).catch(reject);
    });

    return promise;
  };

  /**
   * Checks password against stored credentials
   * @param {String} username
   * @param {String} email
   * @param {String} password
   * @returns {Promise<boolean>} true if correct
   * @throws if user doesn't exist, password doesn't match, or any error
   */
  router.authenticate = async function authenticate ({ username, password }) {
    let storedKey, presentedKey;
    try {
      const bucketName = calcBucketName(username);
      const configPath = posix.join(AUTH_PREFIX, AUTHENTICATION_LOCAL_PASSWORD);
      const storedConfig = await readYaml(bucketName, configPath);
      storedKey = storedConfig.key;
      presentedKey = (await core.hashPassword(password, storedConfig)).key;
    } catch (err) {
      if (err.name === 'NoSuchBucket') {
        getLogger().info(`attempt to log in with nonexistent user “${username}”`);
      } else {
        getLogger().error(`while validating password for “${username}”:`, err);
      }
      throw new Error('Password and username do not match');
    }
    if (presentedKey === storedKey) {
      return true;
    } else {
      throw new Error('Password and username do not match');
    }
  };

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

  function calcBucketName (username) {
    return username.toLowerCase() + userNameSuffix;
  }
  return router;
};
