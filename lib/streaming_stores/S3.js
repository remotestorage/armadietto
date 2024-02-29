const { posix } = require('node:path');
const { Readable } = require('node:stream'); // eslint-disable-line no-unused-vars
const { createHash } = require('node:crypto');
const TimeoutError = require('../util/timeoutError');
const normalizeETag = require('../util/normalizeETag');
const YAML = require('yaml');
const {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  GetObjectCommand, PutBucketVersioningCommand, DeleteObjectsCommand, ListObjectVersionsCommand,
  DeleteObjectCommand, HeadObjectCommand
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const core = require('../stores/core');
const { getLogger } = require('../logger');
const { dirname, basename } = require('path');
const ParameterError = require('../util/ParameterError');

const PUT_TIMEOUT = 24 * 60 * 60 * 1000;
const AUTH_PREFIX = 'remoteStorageAuth';
const AUTHENTICATION_LOCAL_PASSWORD = 'authenticationLocalPassword';
const USER_METADATA = 'userMetadata';
const FILE_PREFIX = 'remoteStorageBlob';
const EMPTY_DIRECTORY = { '@context': 'http://remotestorage.io/spec/folder-description', items: {} };

/** uses the AWS S3 client to connect to any S3-compatible storage that supports versioning
 * TODO: throw standardized errors */
class S3 {
  #S3Client;

  /** Using the default arguments connects you to a public server where anyone can read and delete your data! */
  constructor (endPoint = 'play.min.io', accessKey = 'Q3AM3UQ867SPQQA43P2F', secretKey = 'zuf+tfteSlswRu7BJ86wekitnifILbZam1KYY3TG', region = 'us-east-1') {
    const sslEnabled = !/\blocalhost\b|\b127.0.0.1\b|\b10.0.0.2\b/.test(endPoint);
    if (!endPoint.startsWith('http')) {
      endPoint = (sslEnabled ? 'https://' : 'http://') + endPoint;
    }
    if (!/:\d{1,5}\/?$/.test(endPoint)) {
      endPoint += ':9000';
    }

    this.#S3Client = new S3Client({
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
  }

  /**
   * Creates a versioned bucket with authentication & version data for the new user.
   * @param {Object} params
   * @param {string} params.username
   * @param {string} params.email
   * @param {string} params.password
   * @returns {Promise<string>} name of bucket
   */
  async createUser (params) {
    const { username, email, password } = params;

    const errors = core.validateUser(params);
    if (errors.length > 0) {
      const msg = errors.map(err => err.message).join('|');
      throw new Error(msg);
    }

    try {
      await this.#S3Client.send(new CreateBucketCommand({ Bucket: username }));

      await this.#S3Client.send(new PutBucketVersioningCommand({
        Bucket: username,
        VersioningConfiguration: { Status: 'Enabled' }
      }));

      const config = await core.hashPassword(password, null);

      const hashedPasswordBlobPath = posix.join(AUTH_PREFIX, AUTHENTICATION_LOCAL_PASSWORD);
      await this.#S3Client.send(new PutObjectCommand({ Bucket: username, Key: hashedPasswordBlobPath, Body: YAML.stringify(config), ContentType: 'application/yaml' }));

      const metadata = { email };
      const metadataPath = posix.join(AUTH_PREFIX, USER_METADATA);
      await this.#S3Client.send(new PutObjectCommand({ Bucket: username, Key: metadataPath, Body: YAML.stringify(metadata), ContentType: 'application/yaml' }));

      getLogger().notice(`bucket ${username} created.`);
      // TODO: delete older versions
      return username;
    } catch (err) {
      if (err.name === 'BucketAlreadyOwnedByYou') {
        throw new Error(`Username “${username}” is already taken`, { cause: err });
      } else {
        getLogger().error('while creating bucket or writing initial blobs', err);
        throw new Error('while creating bucket or writing initial blobs: ' + err, { cause: err });
      }
    }
  }

  /**
   * Deletes all of user's files and the bucket. NOT REVERSIBLE.
   * @param username
   * @returns {Promise<number>} number of files deleted
   */
  async deleteUser (username) {
    return new Promise((resolve, reject) => {
      const DELETE_GROUP_SIZE = 100;
      const objectVersions = [];
      let numRequested = 0; let numResolved = 0; let isReceiveComplete = false;

      const removeObjectVersions = async () => {
        let group;
        try {
          if (objectVersions.length > 0) {
            group = objectVersions.slice(0);
            objectVersions.length = 0;
            numRequested += group.length;
            const { Errors } = await this.#S3Client.send(new DeleteObjectsCommand({ Bucket: username, Delete: { Objects: group } }));
            numResolved += group.length;
            if (Errors?.length > 0) {
              getLogger().error('errors deleting object versions:', YAML.stringify(Errors));
            }
          }
        } catch (err) {
          if (err.name === 'NoSuchBucket') {
            resolve(numResolved);
          } else if (err.name === 'NotImplemented') { // OpenIO
            getLogger().warning('while deleting object versions: ' + err);
            for (const objectVersion of group) {
              const { Errors } = await this.#S3Client.send(new DeleteObjectCommand({ Bucket: username, Key: objectVersion.Key, VersionId: objectVersion.VersionId }));
              if (Errors?.length > 0) {
                getLogger().error('errors deleting object version:', YAML.stringify(Errors));
              }
              ++numResolved;
            }
          } else {
            reject(Object.assign(new Error('while deleting object versions: ' + err), { cause: err }));
          }
        }
        try {
          if (isReceiveComplete && numResolved === numRequested) {
            // will fail if any object versions remain
            await this.#S3Client.send(new DeleteBucketCommand({ Bucket: username }));
            resolve(numResolved);
          }
        } catch (err) {
          if (err.name === 'NoSuchBucket') {
            resolve(numResolved);
          } else {
            reject(new Error('while deleting bucket: ' + err));
          }
        }
      };

      const removeObjectVersionsAndBucket = async err => {
        try {
          isReceiveComplete = true;
          await removeObjectVersions();
          if (err) {
            reject(err);
          }
        } catch (err2) {
          reject(err || err2);
        }
      };

      let keyMarker = null;
      const pageVersions = async () => {
        try {
          const { Versions, IsTruncated, NextKeyMarker } = await this.#S3Client.send(new ListObjectVersionsCommand({ Bucket: username, KeyMarker: keyMarker /*, MaxKeys: DELETE_GROUP_SIZE */ }));
          keyMarker = NextKeyMarker;
          objectVersions.push(...Versions);
          isReceiveComplete = !IsTruncated;
          if (objectVersions.length >= DELETE_GROUP_SIZE || !IsTruncated) {
            await removeObjectVersions();
          }
          if (IsTruncated) {
            return pageVersions();
          }
        } catch (err) {
          if (err.name === 'NoSuchBucket') {
            resolve(numResolved);
          } else {
            return removeObjectVersionsAndBucket(err);
          }
        }
      };

      pageVersions();
    });
  }

  /**
   * Checks password against stored credentials
   * @param {String} username
   * @param {String} email
   * @param {String} password
   * @returns {Promise<boolean>} true if correct
   * @throws if user doesn't exist, password doesn't match, or any error
   */
  async authenticate ({ username, email, password }) {
    let storedKey, presentedKey;
    try {
      const configPath = posix.join(AUTH_PREFIX, AUTHENTICATION_LOCAL_PASSWORD);
      const storedConfig = await this.#readYaml(username, configPath);
      storedKey = storedConfig.key;
      presentedKey = (await core.hashPassword(password, storedConfig)).key;
    } catch (err) {
      if (err.name === 'NoSuchBucket') {
        getLogger().info(`attempt to log in with nonexistent user “${username}”`);
      } else {
        getLogger().error('while validating password:', err);
      }
      throw new Error('Password and username do not match');
    }
    if (presentedKey === storedKey) {
      return true;
    } else {
      throw new Error('Password and username do not match');
    }
  }

  async get (username, path, condition) {
    try {
      const isDirectoryRequest = path.endsWith('/');
      const s3Path = isDirectoryRequest ? posix.join(FILE_PREFIX, path).slice(0, -1) : posix.join(FILE_PREFIX, path);
      let getParam;
      if (condition?.name === 'If-None-Match') {
        getParam = { Bucket: username, Key: s3Path, IfNoneMatch: condition.ETag };
      } else if (condition?.name === 'If-Match') {
        getParam = { Bucket: username, Key: s3Path, IfMatch: condition.ETag };
      } else { // unconditional
        getParam = { Bucket: username, Key: s3Path };
      }

      const { Body, ETag, ContentType, ContentLength } = await this.#S3Client.send(new GetObjectCommand(getParam));
      const isDirectory = ContentType === 'application/x.remotestorage-ld+json';
      const contentType = isDirectory ? 'application/ld+json' : ContentType;
      if (isDirectoryRequest ^ isDirectory) {
        return { status: 409, readStream: null, contentType, contentLength: null, ETag: null }; // Conflict
      } else {
        return { status: 200, readStream: Body, contentType, contentLength: ContentLength, ETag: normalizeETag(ETag) };
      }
    } catch (err) {
      if (['NotFound', 'NoSuchKey'].includes(err.name)) {
        return { status: 404, readStream: null, contentType: null, contentLength: null, ETag: null };
      } else if (err.name === 'PreconditionFailed') {
        return { status: 412 };
      } else if (err.name === 'NotModified' || err.$metadata?.httpStatusCode === 304 || err.name === 304) {
        return { status: 304, readStream: null, contentType: null, contentLength: null, ETag: null };
      } else {
        throw Object.assign(err, { status: 502 });
      }
    }
  }

  async put (username, pathname, contentType, contentLength, contentStream, condition) {
    if (pathname.length === 0 || /\/\/|(^|\/)\.($|\/)|(^|\/)\.\.($|\/)|\0/.test(pathname)) {
      throw Object.assign(new ParameterError('A parameter value is bad'), { status: 400 });
    }
    if (pathname.endsWith('/')) {
      return ['CONFLICT'];
    }
    const s3Path = posix.join(FILE_PREFIX, pathname);
    let currentETag;
    try {
      const headResponse = await this.#S3Client.send(new HeadObjectCommand({ Bucket: username, Key: s3Path }));
      if (headResponse.ContentType === 'application/x.remotestorage-ld+json') {
        return ['CONFLICT'];
      }
      currentETag = normalizeETag(headResponse.ETag);
    } catch (err) {
      if (err.$metadata?.httpStatusCode === 400 || err.name === '400' || /\bBucket\b/.test(err.message)) {
        throw Object.assign(new ParameterError('A parameter value is bad', { cause: err }), { status: 400 });
      } else if (!['NotFound', 'NoSuchKey'].includes(err.name)) {
        throw Object.assign(err, { status: 502 });
      }
    }

    // checks all ancestor directories
    let ancestorPath = dirname(s3Path);
    do {
      try {
        const { ContentType } = await this.#S3Client.send(new HeadObjectCommand({ Bucket: username, Key: ancestorPath }));
        if (ContentType !== 'application/x.remotestorage-ld+json') {
          return ['CONFLICT'];
        }
      } catch (err) {
        if (!['NotFound', 'NoSuchKey'].includes(err.name)) { throw Object.assign(err, { status: 502 }); }
      }
      ancestorPath = dirname(ancestorPath);
    } while (ancestorPath.length >= FILE_PREFIX.length);

    if (condition?.name === 'If-None-Match' && condition?.ETag === '*') {
      if (currentETag) {
        return ['PRECONDITION FAILED'];
      }
    } else if (condition?.name === 'If-None-Match') {
      if (condition?.ETag === currentETag) {
        return ['PRECONDITION FAILED'];
      }
    } else if (condition?.name === 'If-Match') {
      if (condition?.ETag !== currentETag) {
        return ['PRECONDITION FAILED', currentETag];
      }
    } // else unconditional

    let blobETag;
    try {
      blobETag = await this.#put(username, s3Path, contentType, contentLength, contentStream);
    } catch (err) {
      getLogger().error(`while putting ${username} ${s3Path}:`, err.message);
      if (err.name === 'TimeoutError') {
        return ['TIMEOUT'];
      } else if (err.name === 'NoSuchBucket') {
        throw Object.assign(new ParameterError('A parameter value is bad', { cause: err }), { status: 400 });
      } else {
        throw err;
      }
    }

    // updates all ancestor directories
    let metadata = {
      ETag: blobETag,
      'Content-Type': contentType,
      ...(contentLength >= 0 ? { 'Content-Length': contentLength } : null),
      'Last-Modified': new Date().toUTCString()
    };
    let itemPath = s3Path;
    do {
      let directory;
      try {
        directory = await this.#readJson(username, dirname(itemPath));
      } catch (err) {
        if (!['NotFound', 'NoSuchKey'].includes(err.name)) { throw Object.assign(err, { status: 502 }); }
      }
      if (!(directory?.items instanceof Object)) {
        directory = structuredClone(EMPTY_DIRECTORY);
      }
      if (typeof metadata === 'string') { // item is folder
        directory.items[basename(itemPath) + '/'] = { ETag: metadata };
      } else {
        directory.items[basename(itemPath)] = metadata;
      }
      const dirJSON = JSON.stringify(directory);
      await this.#put(username, dirname(itemPath), 'application/x.remotestorage-ld+json', dirJSON.length, dirJSON);

      if (dirname(itemPath) !== FILE_PREFIX) {
        // calculates ETag for the folder
        const hash = createHash('md5');
        for (const itemMeta of Object.values(directory.items)) {
          hash.update(itemMeta?.ETag?.replace(/^W\/"|^"|"$/g, '') || '');
        }
        metadata = '"' + hash.digest('hex') + '"';
      }

      itemPath = dirname(itemPath);
    } while (itemPath.length > FILE_PREFIX.length);

    const result = currentETag ? 'UPDATED' : 'CREATED';

    return [result, blobETag];
  }

  async #put (username, s3Path, contentType, contentLength, contentStream) {
    if (contentLength <= 500_000_000) {
      const putPrms = this.#S3Client.send(new PutObjectCommand(
        { Bucket: username, Key: s3Path, Body: contentStream, ContentType: contentType, ContentLength: contentLength }));
      const timeoutPrms = new Promise((_resolve, reject) =>
        setTimeout(reject, PUT_TIMEOUT, new TimeoutError(`PUT of ${contentLength / 1_000_000} MB to ${username} ${s3Path} took more than ${Math.round(PUT_TIMEOUT / 60_000)} minutes`)));
      const putResponse = await Promise.race([putPrms, timeoutPrms]);
      return normalizeETag(putResponse.ETag);
    } else {
      const parallelUpload = new Upload({
        client: this.#S3Client,
        params: { Bucket: username, Key: s3Path, Body: contentStream, ContentType: contentType, ContentLength: contentLength }
      });

      parallelUpload.on('httpUploadProgress', (progress) => {
        console.debug(username, s3Path, `part ${progress.part}   ${progress.loaded} / ${progress.total} bytes`);
      });

      return normalizeETag((await parallelUpload.done()).ETag);
    }
  }

  async delete (username, path, condition) {
    if (path.endsWith('/')) {
      return [409]; // Conflict
    }
    const s3Path = posix.join(FILE_PREFIX, path);
    let currentETag;
    try {
      const headResponse = await this.#S3Client.send(new HeadObjectCommand({ Bucket: username, Key: s3Path }));
      if (headResponse.ContentType === 'application/x.remotestorage-ld+json') {
        return [409]; // Conflict
      }
      currentETag = normalizeETag(headResponse.ETag);
    } catch (err) {
      if (['NotFound', 'NoSuchKey'].includes(err.name)) {
        return [404];
      } else if (err.$metadata?.httpStatusCode === 400 || err.name === '400' || /\bBucket\b/.test(err.message)) {
        throw Object.assign(new ParameterError('A parameter value is bad', { cause: err }), { status: 400 });
      } else {
        throw Object.assign(err, { status: 502 });
      }
    }

    let deleteParam;
    if (condition?.name === 'If-None-Match') {
      deleteParam = { Bucket: username, Key: s3Path, IfNoneMatch: condition.ETag };
    } else if (condition?.name === 'If-Match') {
      deleteParam = { Bucket: username, Key: s3Path, IfMatch: condition.ETag };
    } else { // unconditional
      deleteParam = { Bucket: username, Key: s3Path };
    }
    /* const { DeleteMarker, VersionId } = */ await this.#S3Client.send(new DeleteObjectCommand(deleteParam));

    // TODO: delete entry in parent and empty parents

    return [204, currentETag];
  }

  async #readYaml (username, s3Path) {
    const { Body } = await this.#S3Client.send(new GetObjectCommand({ Bucket: username, Key: s3Path }));
    const string = (await Body.setEncoding('utf-8').toArray())[0];
    return YAML.parse(string);
  }

  async #readJson (username, s3Path) {
    const { Body } = await this.#S3Client.send(new GetObjectCommand({ Bucket: username, Key: s3Path }));
    const string = (await Body.setEncoding('utf-8').toArray())[0];
    return JSON.parse(string);
  }
}

module.exports = S3;
