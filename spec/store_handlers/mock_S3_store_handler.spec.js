/* eslint-env mocha */
const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-spies'));
const { S3Client } = require('@aws-sdk/client-s3');
const s3StoreHandler = require('../../lib/routes/S3_store_router');
const callMiddleware = require('../util/callMiddleware');
const { configureLogger } = require('../../lib/logger');

describe('S3 store router with malformed backend ETags', function () {
  const storedETag = 'W/ABC123';
  let originalSend;
  let handler;

  before(function () {
    configureLogger({ stdout: [], log_files: [] });
    originalSend = S3Client.prototype.send;
    S3Client.prototype.send = async function (command) {
      switch (command.constructor.name) {
        case 'CreateBucketCommand': return {};
        case 'ListBucketsCommand': return { Buckets: [] };
        case 'ListObjectsV2Command':
          return {
            Contents: [{ Key: 'remoteStorageBlob/cat/doc', ETag: storedETag }],
            IsTruncated: false
          };
        case 'DeleteObjectsCommand': return { Deleted: command.input.Delete.Objects };
        default: throw new Error(`Unexpected command: ${command.constructor.name}`);
      }
    };
    handler = s3StoreHandler({ endPoint: 'http://localhost:9000', userNameSuffix: '-test.invalid' });
  });

  after(function () {
    S3Client.prototype.send = originalSend;
  });

  it('accepts a normalized If-Match for an unquoted weak backend ETag', async function () {
    const [, response] = await callMiddleware(handler, {
      method: 'DELETE',
      url: '/alice/cat/doc',
      headers: { 'If-Match': 'W/"abc123"' }
    });

    expect(response.statusCode).to.equal(204);
  });

  it('normalizes the ETag in a successful DELETE response', async function () {
    const [, response] = await callMiddleware(handler, {
      method: 'DELETE',
      url: '/alice/cat/doc'
    });

    expect(response.statusCode).to.equal(204);
    expect(response.get('ETag')).to.equal('W/"abc123"');
  });
});
