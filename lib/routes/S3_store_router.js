/* streaming storage to an S3-compatible service */

/* eslint-env node */
/* eslint-disable camelcase */
const errToMessages = require('../util/errToMessages');
const { createHash, randomBytes } = require('node:crypto');
const express = require('express');
const http = require('node:http');
const https = require('node:https');
const {
  HeadObjectCommand, S3Client, DeleteObjectCommand, GetObjectCommand, PutObjectCommand,
  CreateBucketCommand,
  PutBucketVersioningCommand, PutBucketLifecycleConfigurationCommand,
  ListObjectVersionsCommand,
  DeleteBucketCommand, GetBucketVersioningCommand, ListBucketsCommand, ListObjectsV2Command, DeleteObjectsCommand,
  waitUntilBucketExists, waitUntilObjectExists
} = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const normalizeETag = require('../util/normalizeETag');
const ParameterError = require('../util/ParameterError');
const EndResponseError = require('../util/EndResponseError');
const { dirname, basename, posix } = require('node:path');
const YAML = require('yaml');
const TimeoutError = require('../util/timeoutError');
const { Upload } = require('@aws-sdk/lib-storage');
const { pipeline } = require('node:stream/promises');
const { getLogger } = require('../logger');
const proquint = require('proquint');
const { calcContactURL } = require('../../lib/util/protocols');
const NoSuchUserError = require('../util/NoSuchUserError');
const NoSuchBlobError = require('../util/NoSuchBlobError');
const shorten = require('../util/shorten');
const { POINTS_UNAUTH_REQUEST, rateLimiterPenalty } = require('../middleware/rateLimiterMiddleware');

const ID_NUM_BITS = 64;
const MAX_KEY_LENGTH = 910; // MinIO in /var/minio; OpenIO: 1023; AWS & play.min.io: 1024
const CONTENT_TYPE_SEPARATOR = '!'; // separates Content-Type from path
const TYPE_SUFFIX_PATT = /!(application|audio|font|image|model|text|video)!2F[A-Za-z0-9][A-Za-z0-9_.!'-]{0,100}$/;
const ADMIN_NAME = 'admin'; // this plus the userNameSuffix is the admin bucket name
const AUTH_PREFIX = 'remoteStorageAuth';
const USER_METADATA = 'userMetadata';
const BLOB_PREFIX = 'remoteStorageBlob/';
const FOLDER_MIME_TYPE = 'application/ld+json'; // external type (Linked Data)
const EMPTY_FOLDER = { '@context': 'http://remotestorage.io/spec/folder-description', items: {} };
const INITIAL_S3_PAUSE_MS = 2000;
const MAX_S3_PAUSE_MS = 10 * 60 * 1000;
const S3_PAUSE_INCREASE = 1.5;
const S3_PAUSE_DECREASE = 0.9;
const BACK_END_STORAGE_OFFLINE = 'back-end storage off-line'; // used in error messages, not UI

/**
 * A factory to create a store router for S3-compatible storage. User buckets may be shared with other apps.
 * @param {string} endPoint the protocol and hostname, and optionally the port
 * @param {string} accessKey effectively the admin user account name
 * @param {string} secretKey
 * @param {string} region only required for AWS
 * @param {string} userNameSuffix required for AWS and other shared namespaces
 * @returns {Router}
 */
module.exports = function ({ endPoint = 'play.min.io', accessKey = 'Q3AM3UQ867SPQQA43P2F', secretKey = 'zuf+tfteSlswRu7BJ86wekitnifILbZam1KYY3TG', region = 'us-east-1', userNameSuffix = '' }) {
  const sslEnabled = !/\blocalhost\b|\b127.0.0.1\b|\b10.0.0.2\b/.test(endPoint);
  if (!endPoint.startsWith('http')) {
    endPoint = (sslEnabled ? 'https://' : 'http://') + endPoint;
  }

  const MAX_S3_SOCKETS = 50;
  const MAX_WAITING_S3_REQUESTS = 70; // Smithy warns at something like 100
  const httpAgent = new http.Agent({ maxSockets: MAX_S3_SOCKETS });
  const httpsAgent = new https.Agent({ maxSockets: MAX_S3_SOCKETS });
  const s3Agent = endPoint.startsWith('https') ? httpsAgent : httpAgent;
  const requestHandler = process.env.DEBUG
    ? new S3RequestLogger({ httpAgent, httpsAgent })
    : new NodeHttpHandler({ httpAgent, httpsAgent });
  const s3client = new S3Client({
    forcePathStyle: true,
    region,
    endpoint: endPoint,
    sslEnabled,
    requestHandler,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      Version: 1
    }
    // logger: getLogger(),
  });
  s3client.send(new CreateBucketCommand({ Bucket: calcBucketName(ADMIN_NAME) })).then(resp => {
    getLogger().notice(`created (or re-created) admin bucket: ${resp.Location || calcBucketName(ADMIN_NAME)}`);
  }).catch(err => {
    if (['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(err.name)) {
      getLogger().notice(`admin bucket already exists: ${calcBucketName(ADMIN_NAME)}`);
    } else {
      getLogger().alert(Array.from(errToMessages(err, new Set(['while creating admin bucket:']))).join(' '));
    }
  });
  s3client.send(new ListBucketsCommand({})).then(({ Buckets }) => {
    const users = [];
    let numAdminBuckets = 0; let numOtherBuckets = 0;
    for (const bucket of Buckets) {
      if (bucket.Name.endsWith(userNameSuffix)) {
        if (bucket.Name === ADMIN_NAME + userNameSuffix) {
          ++numAdminBuckets;
        } else {
          users.push(bucket.Name.slice(0, -userNameSuffix.length));
        }
      } else {
        ++numOtherBuckets;
      }
    }
    getLogger().notice(`${endPoint} ${accessKey} has ${users.length} users: ` + shorten(users.join(', '), 200));
    getLogger().notice(`${endPoint} ${accessKey} has ${numAdminBuckets} admin bucket & ${numOtherBuckets} buckets that are not accounts (don't end with “${userNameSuffix}”)`);
  }).catch(err => { // it's bad if storage can't be reached
    getLogger().alert(Array.from(errToMessages(err, new Set(['while listing buckets:']))).join(' '));
  });

  // When pausing, a new s3PausePrms replaces the old, *and* numS3Pauses is incremented.
  // If pausing is triggered while already paused, a new s3PausePrms replaces the old.
  // S3 requests waiting on the old promise will be launched on their current schedule,
  // but S3 requests that start pausing afterward will wait longer (thus spreading
  // requests out).  When numS3Pauses is greater than zero, new client requests will
  // be rejected.
  let s3PauseMs = INITIAL_S3_PAUSE_MS;
  let s3PausePrms = Promise.resolve(true); // initially not paused
  let numS3Pauses = 0; // initially not paused
  async function s3send (...command) {
    await s3PausePrms;
    return s3client.send(...command);
  }

  const router = express.Router();

  router.get('/:username/*',
    rejectIfBusy,
    async function (req, res, next) {
      let bucketName;
      let s3Path;
      let isFolderRequest;
      try {
        bucketName = calcBucketName(req.params.username);

        isFolderRequest = req.url.endsWith('/');
        s3Path = calcS3Path(BLOB_PREFIX, req.params[0]);
        let getParam;
        if (req.get('If-None-Match')) {
          getParam = { Bucket: bucketName, Key: s3Path, IfNoneMatch: req.get('If-None-Match') };
        } else if (req.get('If-Match')) {
          getParam = { Bucket: bucketName, Key: s3Path, IfMatch: req.get('If-Match') };
        } else { // unconditional
          getParam = { Bucket: bucketName, Key: s3Path };
        }

        const { Body, ETag, ContentType, ContentLength } = await s3send(new GetObjectCommand(getParam));
        const isFolder = ContentType === FOLDER_MIME_TYPE;
        const contentType = isFolder ? FOLDER_MIME_TYPE : ContentType;
        if (isFolderRequest ^ isFolder) {
          res.logNotes.add(`isFolderRequest: ${isFolderRequest} isFolder: ${isFolder}`);
          return res.status(409).type('text/plain').send('folder/document conflict');
        } else {
          res.status(200).set('Content-Length', ContentLength).set('Content-Type', contentType).set('ETag', normalizeETag(ETag));
          return pipeline(Body, res).then(reduceS3PauseBecauseOfSuccess);
        }
      } catch (err) {
        try {
          if (['NoSuchBucket', 'AccessDenied'].includes(err.Code) ||
              ['NoSuchBucket', 'Forbidden', 'AccessDenied', '403'].includes(err.name) ||
              [403].includes(err.$metadata?.httpStatusCode)) {
            errToMessages(err, res.logNotes);
            return res.status(404).end(); // Not Found
          } else if (['NotFound', 'NoSuchKey'].includes(err.name) ||
              [404].includes(err.$metadata?.httpStatusCode)) {
            if (isFolderRequest) {
              const folder = await listFolder(req.params.username, req.params[0], req.app.get('folder_items_contain_type'), res.logNotes);
              const folderJson = normalizedJson(folder);
              const digest = createHash('md5').update(folderJson).digest('hex');

              if (req.get('If-None-Match') && stripQuotes(req.get('If-None-Match')) === digest) {
                return res.status(304).end();
              } else if (req.get('If-Match') && stripQuotes(req.get('If-Match')) !== digest) {
                return res.status(412).end();
              }
              res.set('ETag', normalizeETag(`"${digest}"`));
              res.type(FOLDER_MIME_TYPE).send(folderJson);
            } else {
              const { Contents } =
                  await s3send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: s3Path + '/' }));
              if (Contents?.length > 0) {
                res.logNotes.add('is actually folder');
                return res.status(409).type('text/plain').send('is actually folder: ' + req.params[0]);
              } else {
                errToMessages(err, res.logNotes);
                return res.status(404).end(); // Not Found
              }
            }
          } else if (['PreconditionFailed', '412'].includes(err.name) || err.$metadata?.httpStatusCode === 412) {
            errToMessages(err, res.logNotes);
            return res.status(412).end();
          } else if (['NotModified', '304'].includes(err.name) || err.$metadata?.httpStatusCode === 304) {
            return res.status(304).end();
          } else if (err.name === 'EndResponseError') {
            res.logNotes.add(err.message);
            res.logLevel = err.logLevel;
            return res.status(err.statusCode).type('text/plain').send(err.message);
          } else if (err.code === 'ECONNREFUSED' || err.Code === 'ServiceUnavailable') {
            errToMessages(err, res.logNotes);
            res.set({ 'Retry-After': Math.ceil(s3PauseMs / 1000).toString() });
            res.status(503).type('text/plain').send(BACK_END_STORAGE_OFFLINE);
          } else if (err.Code === 'SlowDown' || err.$metadata?.httpStatusCode === 503) {
            errToMessages(err, res.logNotes);
            pauseS3Requests(res);
            return res.status(429).end();
          } else {
            respondWithMsgId(res, err.$metadata?.httpStatusCode || 502, err);
          }
        } catch (err2) {
          if (err2.name === 'EndResponseError') {
            res.logNotes.add(err2.message);
            res.logLevel = err2.logLevel;
            return res.status(err2.statusCode).type('text/plain').send(err2.message);
          } else {
            respondWithMsgId(res, err2.$metadata?.httpStatusCode || 502, err2);
          }
        }
      }
    }
  );

  /**
   * list all items in a folder using S3 keys
   * @param username
   * @param {string} targetPath the prefix of the folder to list
   * @param {boolean} folderItemsContainType normally true
   * @param {Set<string>} logNotes
   * @return {Promise<Object>} metadata of the items: relative path, contentLength, ETag, lastModified
   */
  async function listFolder (username, targetPath, folderItemsContainType, logNotes) {
    const bucketName = calcBucketName(username);
    if (targetPath.at(-1) !== '/') { targetPath += '/'; }
    const s3Path = calcS3Path(BLOB_PREFIX, targetPath);

    const folders = new Map(); // folder-path to folder-items
    const cachedFolders = new Set(); // paths of existing cached folders

    let ContinuationToken;
    do {
      const { Contents, IsTruncated, NextContinuationToken } = await s3send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: s3Path.slice(0, -1), ...(ContinuationToken && { ContinuationToken }) }));

      if (!Contents?.length) { break; }

      for (const entry of Contents) {
        if (entry.Key.length < s3Path.length) {
          // There's a file at this targetPath
          if (Contents.filter(entry => entry.Key.startsWith(s3Path)).length === 0) {
            throw new EndResponseError('is document, not folder', undefined, 409);
          }
          continue;
        } else if (entry.Key === s3Path) {
          // This is the folder entry
          // TODO: can we assume the folder entry is correct and abort?
          // cachedFolders.add(targetPath); // This would prevent children from being added.
          continue;
        }

        const relativePath = entry.Key.slice(s3Path.length);
        const folderPath = dirname(relativePath) === '.' ? '' : dirname(relativePath) + '/';

        if (folderPath && !relativePath.endsWith('/')) { // this folder contains at least one document
          const grandparentPath = dirname(folderPath) === '.' ? '' : dirname(folderPath) + '/';
          const grandparent = folders.get(grandparentPath);
          if (grandparent?.[basename(folderPath)]) { // document that can't co-exist with folder
            grandparent[basename(folderPath)] = undefined; // removes the false document entry
          }
        }
        if (Array.from(cachedFolders).some(cachedFolderPath => folderPath.startsWith(cachedFolderPath))) {
          continue; // children of cached folders are not examined
        }

        const itemName = relativePath.slice(folderPath.length);
        processEntry(entry, folderPath, itemName);
      }
      ContinuationToken = IsTruncated ? NextContinuationToken : undefined;
    } while (ContinuationToken);

    const incompleteFolders = new Set();
    if (folderItemsContainType) {
      const metadataStartTime = Date.now();
      const metadataPromises = []; // promises
      // If Content-Type was not retrieved from 0-byte blob cache, launches a HEAD request for it.
      outerLoop: for (const [folderPath, items] of folders) { // eslint-disable-line no-labels
        for (const [name, metadata] of Object.entries(items)) {
          if (name.endsWith('/') || metadata['Content-Type'] || TYPE_SUFFIX_PATT.test(name)) {
            continue;
          }

          const delay = Math.round(10 * calcWaitingS3Requests() / MAX_S3_SOCKETS);
          await new Promise(resolve => setTimeout(resolve, delay));

          if (Date.now() - metadataStartTime > 9_000) {
            logNotes.add('metadata abandoned');
            incompleteFolders.add(folderPath);
            break outerLoop; // eslint-disable-line no-labels
          }

          const itemS3Path = posix.join(s3Path, folderPath, name);
          const metadataPromise = getMetadata(bucketName, itemS3Path, logNotes)
            .then(metadata => {
              items[name] = metadata;
            }).catch(err => {
              incompleteFolders.add(folderPath);
              throw err;
            });
          metadataPromises.push(metadataPromise);
        }
      }
      const outcomes = await Promise.allSettled(metadataPromises);
      const firstRejected = outcomes.find(outcome => outcome.status === 'rejected');
      if (firstRejected) {
        logNotes.add(firstRejected.reason);
      }
    }

    // Currently, there's a folder object for each folder containing documents.
    // Now, we create objects for folders that contain only folders.
    folders.set('', folders.get('') || {}); // target folder
    for (const folderPath of folders.keys()) {
      const segments = folderPath.split('/');
      for (let num = 1; num < segments.length - 1; num++) {
        const ancestorPath = segments.slice(0, num).join('/') + '/';
        folders.set(ancestorPath, folders.get(ancestorPath) || {});
      }
    }
    // Going from deep to shallow sets the item for a folder in its parent folder,
    // before the ETag for the parent is calculated.
    const deepToShallow = Array.from(folders.entries()).sort(([pathA, _itemsA], [pathB, _itemsB]) => pathB.split('/').length - pathA.split('/').length);
    for (const [folderPath, folderItems] of deepToShallow) {
      if (folderPath) { // we don't need the ETag of the target folder
        const parentPath = dirname(folderPath) === '.' ? '' : dirname(folderPath) + '/';
        const parentFolder = folders.get(parentPath) || {};
        const folderJson = normalizedJson({ items: folderItems });
        const digest = createHash('md5').update(folderJson).digest('hex');
        parentFolder[basename(folderPath) + '/'] = { ETag: digest };
        if (incompleteFolders.has(folderPath)) {
          incompleteFolders.add(parentPath);
        }
      }
    }

    const puts = []; // promises
    const keysToDelete = new Set();
    const shallowToDeep = Array.from(folders.entries()).sort(([pathA, _itemsA], [pathB, _itemsB]) => pathA.split('/').length - pathB.split('/').length);
    for (const [folderPath, folder] of shallowToDeep) {
      try {
        if (cachedFolders.has(folderPath)) { continue; }
        const folderS3Path = posix.join(s3Path, folderPath);
        if (incompleteFolders.has(folderPath)) {
          const segments = folderS3Path.split('/');
          for (let i = segments.length - 1; i >= 1; --i) {
            keysToDelete.add(segments.slice(0, i).join('/') + '/');
          }
        } else if (Object.keys(folder).length > 0) {
          const folderJson = normalizedJson({ items: folder });

          const parentFolderPath = dirname(folderPath) === '.' ? '' : dirname(folderPath) + '/';
          const parentFolder = folders.get(parentFolderPath);
          const folderETag = parentFolder?.[basename(folderPath) + '/']?.ETag;

          const putPrms = s3send(new PutObjectCommand(
            { Bucket: bucketName, Key: folderS3Path, Body: folderJson, ContentType: FOLDER_MIME_TYPE, ContentLength: folderJson.length, IfNoneMatch: normalizeETag(folderETag) }))
            .then(_ => {
              logNotes.add(`cached /${folderS3Path.slice(BLOB_PREFIX.length)}`);
            })
            .catch(
              err => errToMessages(err, logNotes)
            );
          puts.push(putPrms);
        }
      } catch (err) {
        if (!(err.Code === 'PreconditionFailed' || ['PreconditionFailed', '412'].includes(err.name))) {
          errToMessages(err, logNotes);
        }
      }
    }
    if (keysToDelete.size > 0) {
      puts.push(s3send(new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: Array.from(keysToDelete).map(key => ({ Key: key })) }
      })).then(({ Deleted, Errors }) => {
        for (const error of Errors || []) {
          if (!['NoSuchKey'].includes(error.Code)) {
            logNotes.add(`${error.Code}:${error.Key}`);
          }
        }
        if (Deleted?.length > 0) {
          logNotes.add('deleted ' + Deleted.map(deletedObj => deletedObj.Key).join(' '));
        }
      }).catch(
        err => errToMessages(err, logNotes)
      ));
    }
    await Promise.allSettled(puts);

    return itemsToSortedFolder(folders.get('')); // target folder

    function processEntry (entry, folderPath, itemName) {
      const folder = folders.get(folderPath) || {};
      let match;
      if (itemName.endsWith('/')) {
        folder[itemName] = { ETag: stripQuotes(entry.ETag) };
        folders.set(folderPath, folder);
        cachedFolders.add(posix.join(folderPath, itemName));
      } else if ((match = TYPE_SUFFIX_PATT.exec(entry.Key))) {
        const properName = itemName.slice(0, -match[0].length);
        if (folder[properName]) {
          folder[properName]['Content-Type'] = calcContentType(match[0]);
        }
      } else {
        folder[itemName] = {
          ETag: stripQuotes(entry.ETag),
          'Content-Type': entry.ContentType, // maybe someday this will work?
          'Content-Length': entry.Size,
          'Last-Modified': entry.LastModified?.toUTCString()
        };
        folders.set(folderPath, folder);
      }
    }
  }
  /** exposed for automated testing */
  router.listFolder = listFolder;

  function getMetadata (bucketName, itemS3Path, logNotes) {
    return s3send(new HeadObjectCommand({
      Bucket: bucketName,
      Key: itemS3Path
    })).then(headResult => {
      if (headResult.DeleteMarker) { // deleted since blobs listed
        // folderItems[name] = undefined;
        return undefined;
      }

      if (headResult.ContentType) {
        const typeCachePath = calcTypeCachePath(itemS3Path, headResult.ContentType);
        if (TYPE_SUFFIX_PATT.test(typeCachePath)) {
          // Does NOT wait for this to complete
          s3send(new PutObjectCommand(
            {
              Bucket: bucketName,
              Key: typeCachePath,
              ContentLength: 0
            }))
            .catch(getLogger().error); // original request has probably completed
        } else {
          logNotes.add(`pattern doesn't match Content-Type: ${headResult.ContentType}`);
        }
      }

      return { // ETag, Content-Length and Last-Modified might be newer
        ETag: stripQuotes(headResult.ETag),
        'Content-Type': headResult.ContentType,
        'Content-Length': headResult.ContentLength,
        'Last-Modified': headResult.LastModified?.toUTCString()
      };
    }).catch(
      err => errToMessages(err, logNotes)
    );
  }

  router.put('/:username/*',
    rejectIfBusy,
    async function (req, res, next) {
      try {
        if (req.url.length === 0 || /\/\/|(^|\/)\.($|\/)|(^|\/)\.\.($|\/)|\0/.test(req.url)) {
          res.logNotes.add('invalid path');
          res.status(400).type('text/plain').send('invalid path');
          return;
        }
        if (req.url.endsWith('/')) {
          await rateLimiterPenalty(req.ip, POINTS_UNAUTH_REQUEST);
          res.status(409).type('text/plain').send("can't overwrite folder");
          return;
        }
        const segments = req.params[0].split('/');
        if (segments.length < 2) {
          return res.status(409).type('text/plain').send("can't create document in root folder");
        }
        const bucketName = calcBucketName(req.params.username);
        const s3Path = calcS3Path(BLOB_PREFIX, req.params[0]);
        const ancestorS3Path = calcS3Path(BLOB_PREFIX, segments.slice(0, 2).join('/'));
        const contentType = req.get('Content-Type') || 'application/binary';
        const keysToBeDeleted = [];
        let currentETag;

        const typeCacheRegEx = new RegExp(req.params[0] + '(' + TYPE_SUFFIX_PATT.source + ')');
        let ContinuationToken;
        do {
          const { Contents, IsTruncated, NextContinuationToken } =
              await s3send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: ancestorS3Path, ContinuationToken }));
          if (!Contents?.length) {
            break;
          }
          for (const entry of Contents || []) {
            let match;
            if (entry.Key === s3Path) {
              currentETag = entry.ETag;
            } else if (!entry.Key.endsWith('/') && s3Path.startsWith(entry.Key + '/')) {
              const msg = 'can\'t be child of document: ' + entry.Key.slice(BLOB_PREFIX.length);
              res.logNotes.add(msg);
              return res.status(409).type('text/plain').send(msg);
            } else if (entry.Key.startsWith(s3Path + '/')) {
              const msg = 'is folder; child is ' + entry.Key.slice(BLOB_PREFIX.length);
              res.logNotes.add(msg);
              return res.status(409).type('text/plain').send(msg);
            } else if ((match = typeCacheRegEx.exec(entry.Key))) {
              if (calcContentType(match[1]) !== contentType) {
                keysToBeDeleted.push(entry.Key);
              }
            }
          }

          ContinuationToken = IsTruncated ? NextContinuationToken : undefined;
        } while (ContinuationToken);

        if (req.get('If-None-Match') === '*' && currentETag) {
          res.logNotes.add('If-None-Match:*');
          res.logNotes.add(currentETag);
          res.status(412).end(); return;
        } else if (req.get('If-None-Match') && req.get('If-None-Match') === currentETag) {
          res.logNotes.add('If-None-Match:' + req.get('If-None-Match'));
          res.status(412).end(); return;
        } else if (req.get('If-Match') && req.get('If-Match') !== currentETag) {
          res.logNotes.add('If-Match:' + req.get('If-Match'));
          res.logNotes.add(currentETag);
          res.status(412).end(); return;
        } // else unconditional

        const promises = [];
        const contentLength = parseInt(req.get('Content-Length')) ? parseInt(req.get('Content-Length')) : undefined;
        let putETag = null;
        promises.push(
          putBlob(bucketName, s3Path, contentType, contentLength, req, currentETag)
            .then(ETag => {
              res.logNotes.add((putETag = ETag));
              return putETag;
            })
        );

        keysToBeDeleted.unshift(...ancestorKeys(bucketName, s3Path));

        promises.push(s3send(new DeleteObjectsCommand({ Bucket: bucketName, Delete: { Objects: keysToBeDeleted.map(key => ({ Key: key })) } })));

        const outcomes = await Promise.allSettled(promises);
        for (const outcome of outcomes) {
          if (outcome.status === 'rejected') {
            if (outcome.reason.name !== 'TimeoutError' && outcome.reason.Code !== 'RequestTimeout') {
              errToMessages(outcome.reason, res.logNotes);
            }
          } else if (Array.isArray(outcome.value?.Errors)) { // DeleteObjectsCommand always succeeds
            for (const error of outcome.value?.Errors) {
              if (!['NoSuchKey'].includes(error.Code)) {
                res.logNotes.add(`${error.Code} ${error.Key}`);
              }
            }
          }
        }
        if (outcomes[0].status === 'rejected') {
          const err = outcomes[0].reason;
          if (['PreconditionFailed', '412'].includes(err.name) || err.code === 'PreconditionFailed') {
            res.status(409).type('text/plain').send('simultaneous upsert');
          } else if (err.name === 'TimeoutError' || err.Code === 'RequestTimeout') {
            try {
              errToMessages(err, res.logNotes);
              if (res.socket) {
                return res.status(504).type('text/plain').send('back-end storage is too slow');
              }
            } catch (err2) {
              getLogger().error('Couldn\'t send body after', ...errToMessages(err, new Set()));
              return res.end();
            }
          } else {
            throw err;
          }
        }

        res.status(currentETag ? 200 : 201).set('ETag', putETag).end();
        reduceS3PauseBecauseOfSuccess();
      } catch (err) {
        if (err.$metadata?.httpStatusCode === 400 || ['400', 'NoSuchBucket'].includes(err.name)) {
          respondWithMsgId(res, err.$metadata?.httpStatusCode || 400, err);
        } else if (err.code === 'ECONNREFUSED' || err.Code === 'ServiceUnavailable') {
          errToMessages(err, res.logNotes);
          res.set({ 'Retry-After': Math.ceil(s3PauseMs / 1000).toString() });
          res.status(503).type('text/plain').send(BACK_END_STORAGE_OFFLINE);
        } else if (err.Code === 'SlowDown' || err.$metadata?.httpStatusCode === 503) {
          errToMessages(err, res.logNotes);
          pauseS3Requests(res);
          return res.status(429).end();
        } else {
          respondWithMsgId(res, err.$metadata?.httpStatusCode || 502, err);
        }
      }
    });

  router.delete('/:username/*',
    rejectIfBusy,
    async function (req, res, next) {
      let bucketName, s3Path;
      try {
        if (req.url.endsWith('/')) {
          await rateLimiterPenalty(req.ip, POINTS_UNAUTH_REQUEST);
          res.logNotes.add('blocked attempt to delete folder directly');
          return res.status(409).type('text/plain').send('can\'t delete folder directly: ' + req.params[0]);
        }
        bucketName = calcBucketName(req.params.username);
        s3Path = calcS3Path(BLOB_PREFIX, req.params[0]);
        const typeCacheRegEx = new RegExp(req.params[0] + TYPE_SUFFIX_PATT.source);

        // lists the blob, all type cache entries, children, and similarly named documents
        const keys = [];
        let ContinuationToken;
        do {
          const { Contents, IsTruncated, NextContinuationToken } =
              await s3send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: s3Path, ...(ContinuationToken && { ContinuationToken }) }));
          for (const entry of Contents || []) {
            if (entry.Key.startsWith(s3Path + '/') && !entry.Key.endsWith('/')) {
              // a child document exists
              res.logNotes.add('blocked attempt to delete folder');
              return res.status(409).type('text/plain').send('is actually folder: ' + req.params[0]);
            } else if (entry.Key === s3Path || typeCacheRegEx.test(entry.Key) || entry.Key.endsWith('/')) {
              // keys includes any cached child folders that shouldn't exist
              keys.push(entry);
            }
          }

          ContinuationToken = IsTruncated ? NextContinuationToken : undefined;
        } while (ContinuationToken);

        let currentETag = null;
        if (keys?.[0]?.Key === s3Path) { // document exists
          // AWS S3 only supports If-Match for Directory Buckets, so we need to check manually.
          // And we have the info to check this.
          currentETag = normalizeETag(keys?.[0]?.ETag);
          if (req.get('If-Match') && req.get('If-Match') !== currentETag) {
            res.logNotes.add('If-Match:' + req.get('If-Match'));
            res.logNotes.add(currentETag);
            return res.status(412).end();
          } else if (req.get('If-None-Match') && req.get('If-None-Match') === currentETag) {
            res.logNotes.add('If-None-Match:' + req.get('If-None-Match'));
            res.logNotes.add(currentETag);
            return res.status(412).end();
          }

          const segments = s3Path.split('/');
          for (let i = segments.length - 1; i >= 1; --i) {
            const ancestorPath = segments.slice(0, i).join('/') + '/';
            keys.push({ Key: ancestorPath });
          }
        }
        if (keys?.length > 0) {
          await s3send(new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: { Objects: keys }
          }));
        }

        // any type cache blobs have been deleted
        if (keys?.[0]?.Key !== s3Path) { // document didn't exist
          return res.status(404).end(); // doesn't return details, to avoid leaking info
        }

        if (currentETag) {
          res.logNotes.add(currentETag);
          res.set('ETag', currentETag);
        }
        res.status(204).end();
        reduceS3PauseBecauseOfSuccess();
      } catch (err) {
        try {
          if (['NoSuchBucket', 'AccessDenied'].includes(err.Code) ||
              ['NoSuchBucket', 'Forbidden', 'AccessDenied', '403'].includes(err.name) ||
              err.$metadata?.httpStatusCode === 403) {
            errToMessages(err, res.logNotes);
            res.status(404).end(); // doesn't return details, to avoid leaking info
          } else if (err.$metadata?.httpStatusCode === 400 || err.name === '400' || /\bBucket\b/.test(err.message)) {
            await rateLimiterPenalty(req.ip, POINTS_UNAUTH_REQUEST);
            errToMessages(err, res.logNotes);
            res.status(400).type('text/plain').send('A parameter value is bad');
          } else if (err.name === 'EndResponseError') {
            res.logNotes.add(err.message);
            res.logLevel = err.logLevel;
            return res.status(err.statusCode).type('text/plain').send(err.message);
          } else if (err.code === 'ECONNREFUSED' || err.Code === 'ServiceUnavailable') {
            errToMessages(err, res.logNotes);
            res.set({ 'Retry-After': Math.ceil(s3PauseMs / 1000).toString() });
            return res.status(503).type('text/plain').send(BACK_END_STORAGE_OFFLINE);
          } else if (err.Code === 'SlowDown' || err.$metadata?.httpStatusCode === 503) {
            errToMessages(err, res.logNotes);
            pauseS3Requests(res);
            return res.status(429).end();
          } else {
            respondWithMsgId(res, err.$metadata?.httpStatusCode || 502, err);
          }
        } catch (err2) {
          if (['NoSuchBucket', 'NotFound', 'Forbidden', 'AccessDenied', '403'].includes(err2.name)) {
            return res.status(404).end(); // doesn't return details, to avoid leaking info
          } else {
            respondWithMsgId(res, err2.$metadata?.httpStatusCode || 502, err2);
          }
        }
      }
    }
  );

  const USER_NAME_PATTERN = new RegExp(`^[a-zA-Z0-9][a-zA-Z0-9-]{1,${61 - userNameSuffix.length}}[a-zA-Z0-9]$`);
  const USER_NAME_ERROR = `Username must contain only letters, digits & hyphens, be 3–${63 - userNameSuffix.length} characters long, and start and end with a letter or digit.`;

  /**
   * Creates a bucket (versioned if supported) and user record.
   * @param {Object} params
   * @param {string} params.username
   * @param {string} params.contactURL typically a mailto: or sms: URL
   * @param {Set} logNotes strings for the notes field in the log
   * @returns {Promise<Object>} user record
   */
  router.createUser = async function createUser (params, logNotes) {
    const username = params.username || proquint.encode(randomBytes(Math.ceil(ID_NUM_BITS / 16) * 2));
    if (!USER_NAME_PATTERN.test(username)) {
      throw new ParameterError(USER_NAME_ERROR);
    }

    const contactURL = calcContactURL(params.contactURL).href; // validates & normalizes

    const normalizedParams = { ...params, username, contactURL };

    if (numS3Pauses > 0) { throw new Error(BACK_END_STORAGE_OFFLINE); }

    // TODO: move check for existing contactURL to account module and call here

    const bucketName = await this.allocateUserStorage(username, logNotes);

    try {
      const metadata = { privileges: {}, ...normalizedParams, storeId: bucketName, credentials: {} };

      const metadataPath = calcS3Path(AUTH_PREFIX, USER_METADATA);
      await s3send(new PutObjectCommand({ Bucket: bucketName, Key: metadataPath, Body: YAML.stringify(metadata), ContentType: 'application/yaml' }));
      await waitUntilObjectExists({ client: s3client, maxWaitTime: 60 },
        { Bucket: bucketName, Key: metadataPath });

      reduceS3PauseBecauseOfSuccess();
      return metadata;
    } catch (err) {
      logNotes.add('while creating user auth or metadata:');
      throw err;
    }
  };

  /** This store router method is called from the account method createUser */
  router.allocateUserStorage = async function (username, logNotes) {
    const bucketName = calcBucketName(username);

    try {
      await s3send(new GetBucketVersioningCommand({ Bucket: bucketName }));
      throw new ParameterError(`Username “${username}” is already taken`);
    } catch (err) {
      if (err.name !== 'NoSuchBucket') {
        throw err;
      } // else bucket doesn't exist, thus the username is available for the new user
    }

    try {
      await s3send(new CreateBucketCommand({ Bucket: bucketName }));
      await waitUntilBucketExists({ client: s3client, maxWaitTime: 60 }, { Bucket: bucketName });
      logNotes.add(`allocated storage for user “${username}”`);
    } catch (err) {
      if (['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(err.name)) {
        throw new ParameterError(`Username “${username}” is already taken`, { cause: err });
      } else {
        logNotes.add('while creating or configuring bucket:');
        throw err;
      }
    }

    try {
      await s3send(new PutBucketVersioningCommand({
        Bucket: bucketName,
        VersioningConfiguration: { Status: 'Enabled' }
      }));
    } catch (err) {
      errToMessages(err, logNotes.add('Couldn\'t set bucket to version blobs:'));
    }

    try {
      await s3send(new PutBucketLifecycleConfigurationCommand({
        Bucket: bucketName,
        LifecycleConfiguration: {
          Rules: [{
            ID: '35days+2',
            Filter: { Prefix: BLOB_PREFIX },
            NoncurrentVersionExpiration: { NoncurrentDays: 35, NewerNoncurrentVersions: 2 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
            Status: 'Enabled'
          }, {
            ID: 'auth+10',
            Filter: { Prefix: AUTH_PREFIX + '/' },
            NoncurrentVersionExpiration: { NoncurrentDays: 1, NewerNoncurrentVersions: 10 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
            Status: 'Enabled'
          }]
        }
      }));
    } catch (err) {
      errToMessages(err, logNotes.add('Couldn\'t set bucket to expire old blob versions:'));
    }

    return bucketName;
  };

  /**
   * store router method
   * @param {string} path the relative path for the blob
   * @param {string} contentType content type (MIME type)
   * @param {string} content
   * @return {Promise<number>} number of bytes written
   * */
  router.upsertAdminBlob = async function (path, contentType, content) {
    const bucketName = calcBucketName(ADMIN_NAME);
    const s3Path = calcS3Path(BLOB_PREFIX, path);

    await s3send(new PutObjectCommand(
      { Bucket: bucketName, Key: s3Path, Body: content, ContentType: contentType, ContentLength: content.length }));

    return content.length;
  };

  /**
   * store router method
   * @param {string} path the relative path of the blob
   * @return {Promise<string>} the blob text
   */
  router.readAdminBlob = async function (path) {
    const bucketName = calcBucketName(ADMIN_NAME);
    const s3Path = calcS3Path(BLOB_PREFIX, path);

    const { Body } = await s3send(new GetObjectCommand({ Bucket: bucketName, Key: s3Path }));
    const chunks = [];
    for await (const chunk of Body) {
      chunks.push(chunk);
    }
    const string = Buffer.concat(chunks).toString('utf-8');

    return string;
  };

  /**
   * store router method
   * @param {string} path the relative path of the blob
   * @return {Promise<{contentLength: *, etag, lastModified: *, acceptRanges: string, contentType: *}>}
   */
  router.metadataAdminBlob = async function (path) {
    try {
      const bucketName = calcBucketName(ADMIN_NAME);
      const s3Path = calcS3Path(BLOB_PREFIX, path);

      const headResponse = await s3send(new HeadObjectCommand({ Bucket: bucketName, Key: s3Path }));
      return {
        contentType: headResponse.ContentType,
        contentLength: headResponse.ContentLength,
        etag: headResponse.ETag,
        lastModified: headResponse.LastModified,
        acceptRanges: headResponse.AcceptRanges
      };
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata.httpStatusCode === 404) {
        throw new NoSuchBlobError(`${path} does not exist`);
      } else {
        throw err;
      }
    }
  };

  /**
   * store router method
   * @param {string} path the relative path of the blob
   * @return {Promise<void>}
   */
  router.deleteAdminBlob = async function (path) {
    const bucketName = calcBucketName(ADMIN_NAME);
    const s3Path = calcS3Path(BLOB_PREFIX, path);

    await s3send(new DeleteObjectCommand({ Bucket: bucketName, Key: s3Path }));
  };

  /**
   * store router method to list all admin blobs w/ the path as prefix
   * @param {string} path the prefix of all blobs to be listed
   * @return {Promise<Object[]>} metadata of the blobs: relative path, contentLength, ETag, lastModified
   */
  router.listAdminBlobs = async function (path) {
    const bucketName = calcBucketName(ADMIN_NAME);
    const s3Path = calcS3Path(BLOB_PREFIX, path);
    const blobsMeta = [];
    let ContinuationToken;
    do {
      const { Contents, IsTruncated, NextContinuationToken } = await s3send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: s3Path, ...(ContinuationToken ? { ContinuationToken } : null) }));

      if (!Contents?.length) { break; }

      // Fetching content-type would require a HEAD call for each blob.
      blobsMeta.push(...Contents.map(m => ({
        path: m.Key.slice(s3Path.length + 1),
        contentLength: m.Size,
        ETag: m.ETag,
        lastModified: m.LastModified
      })));

      ContinuationToken = IsTruncated ? NextContinuationToken : undefined;
    } while (ContinuationToken);

    return blobsMeta;
  };

  /**
   * account method
   * @param logNotes
   * @returns {Promise<*[]>} users, in the order returned by S3
   */
  router.listUsers = async function (logNotes) {
    if (numS3Pauses > 0) { throw new Error(BACK_END_STORAGE_OFFLINE); }
    const { Buckets } = await s3client.send(new ListBucketsCommand({}));
    const userBuckets = Buckets.filter(
      bucket => bucket.Name?.endsWith(userNameSuffix) && bucket.Name !== ADMIN_NAME + userNameSuffix
    );
    const metadataPath = calcS3Path(AUTH_PREFIX, USER_METADATA);
    const outcomes = await Promise.allSettled(userBuckets.map(bucket => readYaml(bucket.Name, metadataPath)));
    const users = [];
    for (let i = 0; i < outcomes.length; ++i) {
      if (outcomes[i].status === 'fulfilled') {
        users.push(outcomes[i].value);
      } else {
        errToMessages(outcomes[i].reason, logNotes);
        const username = userBuckets[i].Name?.endsWith(userNameSuffix)
          ? userBuckets[i].Name.slice(0, -userNameSuffix.length)
          : userBuckets[i].Name;
        users.push({ username, contactURL: '‽', privileges: {}, lastUsed: '' });
      }
    }
    reduceS3PauseBecauseOfSuccess();
    return users;
  };

  /**
   * account method
   * @param username
   * @param _logNotes
   * @returns {Promise<*>}
   */
  router.getUser = async function (username, _logNotes) {
    const bucketName = calcBucketName(username);
    const metadataPath = calcS3Path(AUTH_PREFIX, USER_METADATA);
    try {
      return await readYaml(bucketName, metadataPath);
    } catch (err) {
      if (['NoSuchBucket', 'InvalidBucketName', 'PermanentRedirect'].includes(err.Code)) {
        throw new NoSuchUserError(`No user "${username}"`, { cause: err });
      } else {
        throw err;
      }
    }
  };

  /**
   * account method
   * @param {Object} user
   * @param {Set} _logNotes
   * @returns {Promise<>}
   */
  router.updateUser = async function (user, _logNotes) {
    const bucketName = calcBucketName(user.username);
    const metadataPath = calcS3Path(AUTH_PREFIX, USER_METADATA);
    try {
      await s3send(new PutObjectCommand({ Bucket: bucketName, Key: metadataPath, Body: YAML.stringify(user), ContentType: 'application/yaml' }));
      await waitUntilObjectExists({ client: s3client, maxWaitTime: 60 },
        { Bucket: bucketName, Key: metadataPath });
    } catch (err) {
      if (['NoSuchBucket', 'InvalidBucketName', 'PermanentRedirect'].includes(err.Code)) {
        throw new NoSuchUserError(`No user "${user.username}"`, { cause: err });
      } else {
        throw err;
      }
    }
  };

  /**
   * Deletes all of user's documents & folders and the bucket. NOT REVERSIBLE.
   * @param {string} username
   * @param {Set} logNotes strings for the notes field in the log
   * @returns {[Number, Number, Number]} number of successful deletions, number of errors, number of passes used
   */
  router.deleteUser = async function deleteUser (username, logNotes) {
    const bucketName = calcBucketName(username);
    let numDeletions = 0;
    let numErrors = 0;
    let numPasses = 0;

    if (numS3Pauses > 0) { throw new Error(BACK_END_STORAGE_OFFLINE); }
    try {
      const versioningResult = await s3client.send(new GetBucketVersioningCommand({ Bucket: bucketName }));
      if (['Enabled', 'Suspended'].includes(versioningResult?.Status)) {
        let KeyMarker, VersionIdMarker;
        do {
          const { Versions, DeleteMarkers, IsTruncated, NextKeyMarker, NextVersionIdMarker } = await s3send(new ListObjectVersionsCommand({ Bucket: bucketName, ...(KeyMarker ? { KeyMarker } : null), ...(VersionIdMarker ? { VersionIdMarker } : null) }));

          if (!(Versions?.length) && !(DeleteMarkers?.length)) { break; }

          if (Versions?.length > 0) {
            const { Deleted, Errors } = await s3send(new DeleteObjectsCommand({ Bucket: bucketName, Delete: { Objects: Versions } }));
            numDeletions += Deleted?.length || 0;
            numErrors += Errors?.length || 0;
          }

          if (DeleteMarkers?.length > 0) {
            const { Deleted, Errors } = await s3send(new DeleteObjectsCommand({
              Bucket: bucketName,
              Delete: { Objects: DeleteMarkers }
            }));
            numDeletions += Deleted?.length || 0;
            numErrors += Errors?.length || 0;
          }

          KeyMarker = IsTruncated ? NextKeyMarker : undefined;
          VersionIdMarker = IsTruncated ? NextVersionIdMarker : undefined;

          if (!IsTruncated && ++numPasses >= 100) {
            throw new Error(`for user “${username}” couldn't delete all blobs after ${numPasses} passes`);
          }
        } while (true);
      } else {
        let ContinuationToken;
        do {
          const { Contents, IsTruncated, NextContinuationToken } = await s3send(new ListObjectsV2Command({ Bucket: bucketName, ...(ContinuationToken ? { ContinuationToken } : null) }));

          if (!Contents?.length) { break; }

          const { Deleted, Errors } = await s3send(new DeleteObjectsCommand({ Bucket: bucketName, Delete: { Objects: Contents } }));
          numDeletions += Deleted?.length || 0;
          numErrors += Errors?.length || 0;

          ContinuationToken = IsTruncated ? NextContinuationToken : undefined;
          if (!IsTruncated && ++numPasses >= 100) {
            throw new Error(`for user “${username}” couldn't delete all blobs after ${numPasses} passes`);
          }
        } while (true);
      }

      await s3send(new DeleteBucketCommand({ Bucket: bucketName }));
      logNotes.add(`deleted bucket & ${numDeletions} blobs w/ ${numErrors} errors in ${numPasses} passes`);
      reduceS3PauseBecauseOfSuccess();
      return [numDeletions, numErrors, numPasses];
    } catch (err) {
      if (['NoSuchBucket', 'OperationAborted'].includes(err.Code)) {
        logNotes.add(`bucket already deleted; deleted ${numDeletions} blobs w/ ${numErrors} errors in ${numPasses} passes`);
        return [numDeletions, numErrors, numPasses];
      } else {
        throw err;
      }
    }
  };

  /**
   * returns array of S3 paths to be deleted
   * @param {string} bucketName
   * @param {string} s3Path
   * @returns {string[]}
   */
  function ancestorKeys (bucketName, s3Path) {
    const ancestorPaths = [];
    const segments = s3Path.split('/');
    for (let i = segments.length - 1; i >= 1; --i) {
      ancestorPaths.push(segments.slice(0, i).join('/') + '/');
    }
    return ancestorPaths;
  }

  const PUT_TIMEOUT = 60 * 60 * 1000;
  const MAX_PARTS = 10_000; // AWS limit
  const MIN_PART_SIZE = 5 * 1024 * 1024; // AWS limit

  async function putBlob (bucketName, s3Path, contentType, contentLength, contentStream, prevETag) {
    if (contentLength <= 300_000_000) { // should be as large as practical to avoid the buffering that Upload does
      const putPrms = s3send(new PutObjectCommand(
        { Bucket: bucketName, Key: s3Path, Body: contentStream, ContentType: contentType, ContentLength: contentLength, ...(prevETag && { IfMatch: prevETag }), ...(prevETag === null && { IfNoneMatch: '*' }) }));
      const timeoutPrms = new Promise((_resolve, reject) =>
        setTimeout(reject, PUT_TIMEOUT, new TimeoutError(`PUT of ${contentLength / 1_000_000} MB to ${bucketName} ${s3Path} took more than ${Math.round(PUT_TIMEOUT / 60_000)} minutes`)));
      const putResponse = await Promise.race([putPrms, timeoutPrms]);
      return normalizeETag(putResponse.ETag);
    } else { // Upload is used mainly to deal with contentLength not being available.
      const parallelUpload = new Upload({
        client: s3client,
        params: { Bucket: bucketName, Key: s3Path, Body: contentStream, ContentType: contentType },
        queueSize: 1,
        ...(contentLength >= MAX_PARTS * MIN_PART_SIZE && { partSize: Math.ceil(contentLength / MAX_PARTS) })
        // smaller part size -> fewer bytes buffered in memory
      });
      // Upload allows you to pass ContentLength, but then fails for streams longer than about 5.1MB, with a message about XML.

      parallelUpload.on('httpUploadProgress', (progress) => { // TODO: does this add value?
        console.debug(bucketName, s3Path, `part ${progress.part}   ${progress.loaded?.toLocaleString()} / ${progress.total?.toLocaleString()} bytes`);
      });

      const uploadResponse = await parallelUpload.done();
      return normalizeETag(uploadResponse.ETag);
    }
  }

  async function readYaml (bucketName, s3Path) {
    const { Body } = await s3send(new GetObjectCommand({ Bucket: bucketName, Key: s3Path }));

    const chunks = [];
    for await (const chunk of Body) {
      chunks.push(chunk);
    }
    const string = Buffer.concat(chunks).toString('utf-8');

    return YAML.parse(string);
  }

  async function readJson (bucketName, s3Path, ETag = undefined) {
    const { Body } = await s3send(new GetObjectCommand({ Bucket: bucketName, Key: s3Path, IfNoneMatch: ETag }));

    const chunks = [];
    for await (const chunk of Body) {
      chunks.push(chunk);
    }
    const string = Buffer.concat(chunks).toString('utf-8');

    return JSON.parse(string);
  }
  router.readJson = readJson;

  /**
   * Sorts items so JSON is same for equal folder objects
   * @param folder
   * @returns {string}
   */
  function normalizedJson (folder) {
    const sortedFolder = structuredClone(EMPTY_FOLDER);
    sortedFolder.items = sortItems(folder.items);
    return JSON.stringify(sortedFolder);
  }

  /**
   * Sorts items and wraps in folder
   * @param items
   * @returns {{"@context": string, items: {}}}
   */
  function itemsToSortedFolder (items) {
    const sortedFolder = structuredClone(EMPTY_FOLDER);
    sortedFolder.items = sortItems(items);
    return sortedFolder;
  }

  /**
   * Sorts items so JSON is identical for equal folder objects
   * @param {object} items
   * @returns {object}
   */
  function sortItems (items) {
    const paths = Object.entries(items).filter(([_, value]) => value).map(([key, _]) => key);
    paths.sort();
    const sortedItems = {};
    for (const relativePath of paths) {
      sortedItems[relativePath] = items[relativePath];
    }
    return sortedItems;
  }

  function calcS3Path (prefix, rsPath) {
    return posix.join(prefix, rsPath).slice(0, MAX_KEY_LENGTH);
  }

  function calcBucketName (username) {
    const bucketName = username.toLowerCase() + userNameSuffix;
    if (bucketName.length > 63) {
      throw new Error('Username too long');
    }
    return bucketName;
  }

  function calcTypeCachePath (itemS3Path, contentType) {
    return itemS3Path + CONTENT_TYPE_SEPARATOR + encodeURIComponent(contentType).replaceAll('%', '!');
  }

  function calcContentType (typeSuffix) {
    return decodeURIComponent(typeSuffix.slice(1).replaceAll('!', '%'));
  }

  function pauseS3Requests (res) {
    ++numS3Pauses;
    getLogger().info(`pauseS3Requests: numS3Pauses: ${numS3Pauses}   s3PauseMs: ${s3PauseMs / 1000}s`);
    s3PausePrms = new Promise((resolve) => {
      setTimeout(() => {
        resolve();
        --numS3Pauses; // the order of these statements doesn't matter
        getLogger().info(`pause ended: ${numS3Pauses} pauses: next pause will be ${s3PauseMs / 1000}s long`);
      }, s3PauseMs);
    });
    res.set({ 'Retry-After': Math.ceil(s3PauseMs / 1000).toString() });
    res.logNotes.add(`pausing for ${s3PauseMs / 1000}s`);

    s3PauseMs = Math.min(Math.round(s3PauseMs * S3_PAUSE_INCREASE), MAX_S3_PAUSE_MS);
  }

  function reduceS3PauseBecauseOfSuccess () {
    s3PauseMs = Math.max(Math.round(s3PauseMs * S3_PAUSE_DECREASE), INITIAL_S3_PAUSE_MS);
    if (s3PauseMs > INITIAL_S3_PAUSE_MS) {
      getLogger().debug(`${Date.now() % 100_000} reduceS3PauseBecauseOfSuccess: numS3Pauses: ${numS3Pauses}   s3PauseMs: ${s3PauseMs / 1000}s`);
    }
  }

  /**
   * Rejects new client requests when app server is too heavily loaded.
   * @param {Request} req
   * @param {Response} res
   * @param {Function} next
   */
  function rejectIfBusy (req, res, next) {
    try {
      const numWaitingS3Requests = calcWaitingS3Requests();
      if (numWaitingS3Requests > MAX_WAITING_S3_REQUESTS) {
        const retryAfter = Math.round(numWaitingS3Requests / MAX_S3_SOCKETS);
        res.logNotes.add(`${numWaitingS3Requests} waiting requests; retry-after ${retryAfter}s`);
        res.set({ 'Retry-After': retryAfter });
        return res.status(429).end();
      }

      if (numS3Pauses > 0) {
        getLogger().debug(`${Date.now() % 120_000} rejectIfBusy: numS3Pauses: ${numS3Pauses}   s3PauseMs: ${s3PauseMs / 1000}s`);
        // It's not known how long until s3PausePrms resolves, so tells client to wait the whole value.
        const retryAfterS = Math.ceil(s3PauseMs / 1000).toString();
        res.logNotes.add(`${numS3Pauses} pauses; retry-after ${retryAfterS}s`);
        res.set({ 'Retry-After': retryAfterS });
        return res.status(503).type('text/plain').send(BACK_END_STORAGE_OFFLINE);
      }
    } catch (err) {
      errToMessages(err, res.logNotes);
      // If there's a programming error, we can't actually know whether to reject requests, so this defaults to pass.
    }
    next();
  }

  function calcWaitingS3Requests () {
    return Object.values(s3Agent.requests).reduce((sum, arr) => sum + arr.length, 0);
  }

  return router;
};

/**
 * Catchall error blocks use this to log the error info,
 * without exposing it to the user.  If the user reports the msgId,
 * a sysadmin can find the details in the log.
 * @param {Response} res
 * @param {Number} statusCode HTTP status code
 * @param {Error} [err] error object, if available
 * @param {String} [userMsg] optional user message
 */
function respondWithMsgId (res, statusCode = 500, err, userMsg) {
  const msgId = Math.floor(Math.random() * 1_000_000_000);

  if (userMsg) { res.logNotes.add(userMsg); }
  errToMessages(err, res.logNotes);
  res.logNotes.add(`msgId=${msgId}`);

  const messages = new Set();
  if (userMsg) { messages.add(userMsg); }
  if (process.env.NODE_ENV !== 'production') {
    errToMessages(err, messages);
  }
  messages.add(`msgId=${msgId}`);

  res.status(statusCode).type('text/plain').send(Array.from(messages).join(' '));
}

class S3RequestLogger extends NodeHttpHandler {
  handle (request, { abortSignal }) {
    return super.handle(request, { abortSignal }).then((response) => {
      console.debug('S3', request.method, request.path, request.headers['if-none-match'], request.headers['if-match'], response.response.statusCode, response.response.headers.etag, response.response.headers['content-type'], response.response.headers['content-length']);
      return response;
    });
  }
}

function stripQuotes (ETag) {
  return ETag.replace(/^"|^W\/"|"$/g, '');
}
