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
const { EMAIL_PATTERN, EMAIL_ERROR, PASSWORD_ERROR, PASSWORD_PATTERN } = require('../util/validations');
const normalizeETag = require('../util/normalizeETag');
const ParameterError = require('../util/ParameterError');
const EndResponseError = require('../util/EndResponseError');
const { dirname, basename } = require('path');
const YAML = require('yaml');
const TimeoutError = require('../util/timeoutError');
const { Upload } = require('@aws-sdk/lib-storage');
const { pipeline } = require('node:stream/promises');
const core = require('../stores/core');
const { getLogger } = require('../logger');

const PUT_TIMEOUT = 60 * 60 * 1000;
const MAX_KEY_LENGTH = 910; // MinIO in /var/minio; OpenIO: 1023; AWS & play.min.io: 1024
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

  let pauseUntil = 0; // TODO: actually pause requests until this datetime.  How to test?

  const router = express.Router();

  router.get('/:username/*',
    async function (req, res, next) {
      try {
        const bucketName = calcBucketName(req.params.username);
        const isDirectoryRequest = req.url.endsWith('/');
        const s3Path = calcS3Path(FILE_PREFIX, isDirectoryRequest ? req.params[0].slice(0, -1) : req.params[0]);
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
        } else {
          res.status(200).set('Content-Length', ContentLength).set('Content-Type', contentType).set('ETag', normalizeETag(ETag));
          return pipeline(Body, res);
        }
      } catch (err) {
        if (['NotFound', 'NoSuchKey', 'Forbidden', 'AccessDenied', '403'].includes(err.name) ||
            err.$metadata?.httpStatusCode === 403) {
          return res.status(404).end(); // Not Found
        } else if (err.name === 'PreconditionFailed') {
          return res.status(412).end();
        } else if (['NotModified', '304'].includes(err.name) || err.$metadata?.httpStatusCode === 304) {
          return res.status(304).end();
        } else if (err.name === 'EndResponseError') {
          getLogger().log(err.logLevel || 'info', err.statusCode, err.message, req.params.username, req.params[0]);
          return res.status(err.statusCode).end();
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
        const s3Path = calcS3Path(FILE_PREFIX, req.params[0]);

        let currentETag;
        try {
          const headResponse = await s3client.send(new HeadObjectCommand({ Bucket: bucketName, Key: s3Path }));
          if (headResponse.ContentType === 'application/x.remotestorage-ld+json') {
            res.status(409).type('text/plain').send('can\'t overwrite directory: ' + s3Path); return;
          }
          currentETag = normalizeETag(headResponse.ETag);
        } catch (err) {
          if (err.$metadata?.httpStatusCode === 400 || err.name === '400') {
            return next(Object.assign(new ParameterError('A parameter value is bad', { cause: err }), { status: 400 }));
          } else if (!(['NotFound', 'NoSuchKey', 'Forbidden', 'AccessDenied', '403'].includes(err.name) ||
            err.$metadata?.httpStatusCode === 403)) {
            return next(Object.assign(err, { status: 502 }));
          }
        }

        await checkAncestorsAreFolders(bucketName, s3Path);

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

        const documentMetadata = {
          ETag: putETag,
          'Content-Type': contentType,
          ...(contentLength >= 0 ? { 'Content-Length': contentLength } : null),
          'Last-Modified': new Date().toUTCString()
        };
        await updateAncestors(bucketName, s3Path, putETag, documentMetadata);

        return res.status(currentETag ? 200 : 201).set('ETag', putETag).end();
      } catch (err) {
        if (err.Code === 'SlowDown' || err.$metadata?.httpStatusCode === 503) {
          setPauseUntil(res.get('Retry-After'));
          return next(Object.assign(err, { status: err?.$metadata?.httpStatusCode || 502 }));
        } else if (err.name === 'EndResponseError') {
          getLogger().log(err.logLevel || 'info', err.statusCode, err.message, req.params.username, req.params[0]);
          return res.status(err.statusCode).end();
        } else if (err.name === 'TimeoutError') {
          return res.status(504).end();
        } else if (err.$metadata?.httpStatusCode === 400 || ['400', 'NoSuchBucket'].includes(err.name)) {
          return next(Object.assign(new ParameterError('A parameter value is bad', { cause: err }), { status: 400 }));
        } else {
          return next(Object.assign(err, { status: err?.$metadata?.httpStatusCode || 502 }));
        }
      }
    });

  router.delete('/:username/*',
    async function (req, res, next) {
      try {
        const bucketName = calcBucketName(req.params.username);
        const s3Path = calcS3Path(FILE_PREFIX, req.params[0]);
        const headResponse = await s3client.send(new HeadObjectCommand({ Bucket: bucketName, Key: s3Path }));
        if (headResponse.ContentType === 'application/x.remotestorage-ld+json') {
          return res.status(409).end();
        }
        const currentETag = normalizeETag(headResponse.ETag);

        await checkAncestorsAreFolders(bucketName, s3Path);

        if (req.get('If-Match') && req.get('If-Match') !== currentETag) {
          return res.status(412).end();
        } else if (req.get('If-None-Match') && req.get('If-None-Match') === currentETag) {
          return res.status(412).end();
        }

        await s3client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: s3Path }));

        // metadata = 0 represents a deleted document
        await updateAncestors(bucketName, s3Path, null, 0);

        if (currentETag) {
          res.set('ETag', currentETag);
        }
        res.status(204).end();
      } catch (err) {
        if (['NotFound', 'NoSuchKey', 'Forbidden', 'AccessDenied', '403'].includes(err.name) ||
          err.$metadata?.httpStatusCode === 403) {
          res.status(404).end();
        } else if (err.$metadata?.httpStatusCode === 400 || err.name === '400' || /\bBucket\b/.test(err.message)) {
          res.type('text/plain').send('A parameter value is bad');
        } else if (err.name === 'EndResponseError') {
          getLogger().log(err.logLevel || 'info', err.statusCode, err.message, req.params.username, req.params[0]);
          return res.status(err.statusCode).end();
        } else {
          return next(Object.assign(err, { status: 502 }));
        }
      }
    }
  );

  const USER_NAME_PATTERN = new RegExp(`^[a-zA-Z0-9][a-zA-Z0-9-]{1,${61 - userNameSuffix.length}}[a-zA-Z0-9]$`);
  const USER_NAME_ERROR = `User name must start and end with a letter or digit, contain only letters, digits & hyphens, and be 3–${63 - userNameSuffix.length} characters long.`;

  /**
   * Creates a versioned bucket with authentication & version data for the new user.
   * @param {Object} params
   * @param {string} params.username
   * @param {string} params.email
   * @param {string} params.password
   * @returns {Promise<string>} name of bucket
   */
  router.createUser = async function createUser (params) {
    let { username, email, password } = params;
    username = username.trim();

    if (!USER_NAME_PATTERN.test(username)) {
      throw new Error(USER_NAME_ERROR);
    }
    if (!EMAIL_PATTERN.test(email)) {
      throw new Error(EMAIL_ERROR);
    }
    if (!PASSWORD_PATTERN.test(password)) {
      throw new Error(PASSWORD_ERROR);
    }

    const bucketName = calcBucketName(username);

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

      const hashedPasswordBlobPath = calcS3Path(AUTH_PREFIX, AUTHENTICATION_LOCAL_PASSWORD);
      await s3client.send(new PutObjectCommand({ Bucket: bucketName, Key: hashedPasswordBlobPath, Body: YAML.stringify(config), ContentType: 'application/yaml' }));

      const metadata = { username, email }; // username with original capitalization
      const metadataPath = calcS3Path(AUTH_PREFIX, USER_METADATA);
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
      let pass = 0;

      const deleteItems = async items => {
        for (const item of items) {
          try {
            /* const { DeleteMarker } = */ await s3client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: item.Key, VersionId: item.VersionId }));
            ++numObjectsDeleted;
          } catch (err) {
            console.warn('while deleting', bucketName, item.Key, item.VersionId, err);
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
            pageObjectVersions(NextKeyMarker).catch(reject);
          } else if (Versions?.length > 0 || DeleteMarkers?.length > 0) {
            if (++pass <= 100) {
              pageObjectVersions(undefined).catch(reject);
            } else {
              reject(new Error(`for user “${username}” couldn't delete all object versions after ${pass - 1} passes`));
            }
          } else {
            await s3client.send(new DeleteBucketCommand({ Bucket: bucketName }));
            resolve([numObjectsDeleted, numObjectsFailedToDelete]);
          }
        } catch (err) {
          if (err.name === 'NoSuchBucket') {
            resolve([numObjectsDeleted, numObjectsFailedToDelete]);
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
      const configPath = calcS3Path(AUTH_PREFIX, AUTHENTICATION_LOCAL_PASSWORD);
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

  async function checkAncestorsAreFolders (bucketName, s3Path) {
    // validates that each ancestor folder is a folder or doesn't exist
    let ancestorPath = dirname(s3Path);
    do {
      try {
        const { ContentType } = await s3client.send(new HeadObjectCommand({ Bucket: bucketName, Key: ancestorPath }));
        if (ContentType !== 'application/x.remotestorage-ld+json') {
          throw new EndResponseError('can\'t use document as directory: ' + ancestorPath, undefined, 409);
          // res.status(409).end(); return; // Conflict
        }
      } catch (err) {
        if (!(['NotFound', 'NoSuchKey', 'Forbidden', 'AccessDenied', '403'].includes(err.name) ||
          err.$metadata?.httpStatusCode === 403)) {
          throw Object.assign(err, { status: 502 });
        }
      }
      ancestorPath = dirname(ancestorPath);
    } while (ancestorPath.length >= FILE_PREFIX.length);
  }

  /** checks or updates each ancestor folder */
  async function updateAncestors (bucketName, s3Path, documentETag, documentMetadata) {
    let didChangeAncestor; const ancestorETags = [];
    do {
      // metadata === 0 represents a just-deleted document; metadata === null represents a non-existing folder.
      // metadata === undefined represents a folder with unknown ETag; typeof metadata === 'string' represents folder ETag
      let metadata = documentMetadata;
      let itemPath = s3Path;
      let i = 0;
      didChangeAncestor = false;
      do {
        let parent, parentETag;

        try {
          parent = await readJson(bucketName, dirname(itemPath), ancestorETags[i]);
        } catch (err) {
          if (['NotModified', '304'].includes(err.name) || err.$metadata?.httpStatusCode === 304) {
            parentETag = ancestorETags[i];
          } else if (['NotFound', 'NoSuchKey', 'Forbidden', 'AccessDenied', '403'].includes(err.name) ||
              err.$metadata?.httpStatusCode === 403) {
            parentETag = null;
          } else {
            throw Object.assign(err, { status: 502 });
          }
        }

        if (parentETag === undefined || parentETag !== ancestorETags[i]) {
          if (!(parent?.items instanceof Object)) { // either parent or items property doesn't exist
            parent = structuredClone(EMPTY_DIRECTORY);
          }
          let didChangeParent = false;
          if (metadata === 0) { // item is just-deleted document
            if (parent.items[basename(itemPath)]) {
              delete parent.items[basename(itemPath)];
              didChangeParent = true;
            }
          } else if (metadata instanceof Object) { // item is document
            const entry = parent.items[basename(itemPath)];
            if (entry?.ETag !== documentMetadata.ETag || entry?.['Content-Type'] !== documentMetadata['Content-Type'] ||
              entry?.['Content-Length'] !== documentMetadata['Content-Length'] ||
              entry?.['Last-Modified'] !== documentMetadata['Last-Modified']) {
              parent.items[basename(itemPath)] = structuredClone(metadata);
              didChangeParent = true;
            }
          } else { // item is folder
            const itemName = basename(itemPath) + '/';
            if (metadata) { // folder item exists
              if (parent.items[itemName]?.ETag !== metadata) {
                parent.items[itemName] = { ETag: metadata };
                didChangeParent = true;
              }
            } else { // folder item does not exist
              if (parent.items[itemName]) {
                delete parent.items[itemName];
                didChangeParent = true;
              }
            }
          }
          if (didChangeParent) {
            if (Array.from(Object.keys(parent.items)).length > 0) {
              const dirJSON = JSON.stringify(parent);
              parentETag = await putBlob(bucketName, dirname(itemPath), 'application/x.remotestorage-ld+json', dirJSON.length, dirJSON);
            } else { // There are no children in the parent, so parent is deleted.
              await s3client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: dirname(itemPath) }));
              parentETag = null;
            }
            didChangeAncestor = true;
          } else if (parentETag === undefined) { // Parent was already correct on first pass.
            [parentETag] = await head(bucketName, dirname(itemPath)); // Can't be certain how ETag is calculated.
          }
          ancestorETags[i] = parentETag;
        }
        ++i;

        metadata = parentETag;
        itemPath = dirname(itemPath);
      } while (itemPath.length > FILE_PREFIX.length);

      if (!didChangeAncestor) {
        return;
      }

      // We need to check here, so simultaneous updates to a document don't fight indefinitely.
      const [recheckETag] = await head(bucketName, s3Path);
      if (recheckETag !== documentETag) {
        throw new EndResponseError('Another request is updating this document', null, 409, 'warning');
      }
    } while (true);
  }

  async function head (bucketName, s3Path) {
    try {
      const headResult = await s3client.send(new HeadObjectCommand({ Bucket: bucketName, Key: s3Path }));
      return [normalizeETag(headResult.ETag), headResult.ContentType];
    } catch (err) {
      if (['NotFound', 'NoSuchKey', 'Forbidden', 'AccessDenied', '403'].includes(err.name) ||
          err.$metadata?.httpStatusCode === 403) {
        return [null, null];
      } else {
        throw err;
      }
    }
  }

  async function putBlob (bucketName, s3Path, contentType, contentLength, contentStream) {
    if (contentLength <= 20_000_000) {
      const putPrms = s3client.send(new PutObjectCommand(
        { Bucket: bucketName, Key: s3Path, Body: contentStream, ContentType: contentType, ContentLength: contentLength }));
      const timeoutPrms = new Promise((_resolve, reject) =>
        setTimeout(reject, PUT_TIMEOUT, new TimeoutError(`PUT of ${contentLength / 1_000_000} MB to ${bucketName} ${s3Path} took more than ${Math.round(PUT_TIMEOUT / 60_000)} minutes`)));
      const putResponse = await Promise.race([putPrms, timeoutPrms]);
      return normalizeETag(putResponse.ETag);
    } else {
      // If ContentLength is passed, Upload fails with a message about XML, for streams longer than about 5.1MB
      const parallelUpload = new Upload({
        client: s3client,
        params: { Bucket: bucketName, Key: s3Path, Body: contentStream, ContentType: contentType /*, ContentLength: contentLength */ },
        partSize: 20 * 1024 * 1024
      });

      parallelUpload.on('httpUploadProgress', (progress) => {
        console.debug(bucketName, s3Path, `part ${progress.part}   ${progress.loaded?.toLocaleString()} / ${progress.total?.toLocaleString()} bytes`);
      });

      const uploadResponse = await parallelUpload.done();
      return normalizeETag(uploadResponse.ETag);
    }
  }

  async function readYaml (bucketName, s3Path) {
    const { Body } = await s3client.send(new GetObjectCommand({ Bucket: bucketName, Key: s3Path }));
    const string = (await Body.setEncoding('utf-8').toArray())[0];
    return YAML.parse(string);
  }

  async function readJson (bucketName, s3Path, ETag = undefined) {
    const { Body } = await s3client.send(new GetObjectCommand({ Bucket: bucketName, Key: s3Path, IfNoneMatch: ETag }));
    const string = (await Body.setEncoding('utf-8').toArray())[0];
    return JSON.parse(string);
  }

  function calcS3Path (prefix, rsPath) {
    return posix.join(prefix, rsPath).slice(0, MAX_KEY_LENGTH);
  }

  function calcBucketName (username) {
    return (username.toLowerCase() + userNameSuffix).slice(0, 63);
  }

  function setPauseUntil (retryAfter) {
    pauseUntil = parseInt(retryAfter) > 0
      ? new Date(Date.now() + parseInt(retryAfter))
      : new Date(retryAfter);
    if (!(pauseUntil.valueOf() > Date.now())) {
      pauseUntil = new Date(Date.now() + 5_000);
    }
    // TODO: exponentially increase delay if called multiple times
  }

  return router;
};
