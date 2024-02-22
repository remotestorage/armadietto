const Minio = require('minio');
const core = require('../stores/core');
const { getLogger } = require('../logger');

// const FILE_PREFIX = 'remoteStorageBlob/';
// const AUTH_PREFIX = 'remoteStorageAuth/';

/** uses the min.io client to connect to any S3-compatible storage that supports versioning */
class S3 {
  #minioClient;

  /** Using the default arguments connects you to a public server where anyone can read and delete your data! */
  constructor (endPoint = 'play.min.io', port = 9000, accessKey = 'Q3AM3UQ867SPQQA43P2F', secretKey = 'zuf+tfteSlswRu7BJ86wekitnifILbZam1KYY3TG') {
    this.#minioClient = new Minio.Client({
      endPoint,
      port,
      accessKey,
      secretKey,
      useSSL: !['localhost', '10.0.0.2', '127.0.0.1'].includes(endPoint)
    });
  }

  /**
   * Creates an empty bucket for the new user.
   * @param {Object} params
   * @param {string} params.username
   * @param {string} params.email
   * @param {string} params.password
   * @returns {Promise<string>} name of bucket
   */
  async createUser (params) {
    const errors = core.validateUser(params);
    if (errors.length > 0) {
      const msg = errors.map(err => err.message).join('|');
      throw new Error(msg);
    }

    const bucketName = params.username;
    const exists = await this.#minioClient.bucketExists(bucketName);
    if (exists) {
      throw new Error(`Username “${params.username}” is already taken`);
    } else {
      await this.#minioClient.makeBucket(bucketName);
      await this.#minioClient.setBucketVersioning(bucketName,
        { Status: 'Enabled', ExcludedPrefixes: [{ Prefix: 'permissions' }, { Prefix: 'meta' }] });
      getLogger().info(`bucket ${bucketName} created.`);
      return bucketName;
    }
  }

  /**
   * Deletes all of user's files and the bucket. NOT REVERSIBLE.
   * @param username
   * @returns {Promise<number>} number of files deleted
   */
  async deleteUser (username) {
    if (!await this.#minioClient.bucketExists(username)) { return 0; }

    return new Promise((resolve, reject) => {
      const GROUP_SIZE = 100;
      const objectVersions = [];
      let numRequested = 0; let numRemoved = 0; let isReceiveComplete = false;

      const removeObjectVersions = async () => {
        const group = objectVersions.slice(0);
        objectVersions.length = 0;
        numRequested += group.length;
        await this.#minioClient.removeObjects(username, group);
        numRemoved += group.length;

        if (isReceiveComplete && numRemoved === numRequested) {
          await this.#minioClient.removeBucket(username); // will fail if any object versions remain
          resolve(numRemoved);
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

      const objectVersionStream = this.#minioClient.listObjects(username, '', true, { IncludeVersion: true });
      objectVersionStream.on('data', async item => {
        try {
          objectVersions.push(item);
          if (objectVersions.length >= GROUP_SIZE) {
            await removeObjectVersions();
          }
        } catch (err) { // keeps going
          getLogger().error(`while deleting user “${username}” object version ${JSON.stringify(item)}:`, err);
        }
      });
      objectVersionStream.on('error', removeObjectVersionsAndBucket);
      objectVersionStream.on('end', removeObjectVersionsAndBucket);
    });
  }
}

module.exports = S3;
