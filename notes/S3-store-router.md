# S3-compatible Streaming Store

Note: S3-compatible storage trades the strong consistency of a file system for durability and expandability, so this store only offers eventual consistency.

Streaming Stores like this can only be used with the modular server.

## Compatible S3 Implementations

Tested services include:

### AWS S3

* Fully working

### DigitalOcean Spaces

* Fully working

### Scaleway Object Storage

* Fully working

### Garage

* doesn't implement versioning (which would be nice for recovery)

### min.io (both self-hosted and cloud)

* web console can't be used with this, and probably won't ever


### OpenIO
Disrecommended — bugs can't be worked around

* fails simultaneous delete test
* doesn't implement DeleteObjectsCommand

### Other S3-compatible implementations

Run the Mocha test `spec/store_handlers/S3_store_handler.spec.js` with environment variables set.  (See next section.)


## Configuration

Configure the store router by passing to the constructor the endpoint (host name, and port if not 9000), access key (admin user name) and secret key (password). (If you don't pass any arguments, S3 will use the public account on `play.min.io`, where the documents & folders can be **read, altered and deleted** by anyone in the world! Also, the Min.IO browser can't list your documents or folders.) If you're using a AWS and a region other than `us-east-1`, include that as a fourth argument.  You can provide these however you like, but typically they are stored in these environment variables:

* S3_ENDPOINT
* S3_ACCESS_KEY
* S3_SECRET_KEY
* S3_REGION

For AWS, you must also pass a fifth argument — a user name suffix so bucket names don't collide with other users. By default, this is a hyphen plus `conf.host_identity`, but you can set `conf.user_name_suffix` to override.

Creating an app server then resembles:

```javascript
const s3handler = new S3Handler({
  endPoint: process.env.S3_ENDPOINT,
  accessKey: process.env.S3_ACCESS_KEY,
  secretKey: process.env.S3_SECRET_KEY,
  userNameSuffix});
const app = require('../../lib/appFactory')({accountMgr: s3handler, storeRouter: s3handler, ...});
```

HTTPS is used if the endpoint is not localhost.  If you must use http, you can include the scheme in the endpoint: `http://myhost.example.org`.

This one access key is used to create a bucket for each user.
The bucket name is the id plus the suffix, if any.
If other non-remoteStorage buckets are created at that endpoint, those bucket names will be unavailable as usernames.

## Maintenance / Administration / Integrations

Buckets can be administered, backed up, and restored, using the service's tools, such as a webapp console or a command-line tool such as [aws s3](https://docs.aws.amazon.com/cli/latest/reference/s3/).
The bucket **MUST NOT** contain non-RS blobs ("objects") with these prefixes:

* remoteStorageBlob/
* remoteStorageAuth/

The bucket MAY contain any blobs that don't start with one of those two prefixes.

Deleting a bucket, or all keys in a bucket that start with one of those two prefixes, will cleanly delete a user's account.

### Folder cache blobs

If blobs ("objects") are added, deleted, or changed, the ancestor folder cache blobs SHOULD be deleted.
For example, if you add, delete or modify a blob with the key `remoteStorageBlob/foo/bar/spam`, you SHOULD delete (if they exist) the blobs  `remoteStorageBlob/foo/bar/`, `remoteStorageBlob/foo/` and `remoteStorageBlob/`.
If those ancestor folder cache blobs are not immediately deleted, the changes to `remoteStorageBlob/foo/bar/spam` will not be visible in folder listings, and will not be synced to RS clients.  The changes *will* be visible if reading the document. That would cause unexpected behavior with RS apps.

Backups MAY copy these blobs, but don't have to.
Restores should *only* restore these blobs when doing a complete restore.

#### Forbidden keys

If a blob with the key `remoteStorageBlob/foo/bar/spam` exists, blobs with these keys SHOULD NOT exist: `remoteStorageBlob/foo/bar`, nor `remoteStorageBlob/foo`.

Integrations with other software that follow these rules will work properly with remoteStorage.

### Content-Type cache blobs

When the setting of `folder_items_contain_type` in the config file is left at the default of `true`, the S3 store router also creates blobs to cache the Content-Type of documents, with keys such as `remoteStorageBlob/foo/bar/spam!application!2Fjson!3B!20charset!3DUTF-8`. The RegExp pattern is `/!(application|audio|font|image|model|text|video)!2F[A-Za-z0-9][A-Za-z0-9_.!'-]{0,100}$/`
These blobs SHOULD be ignored by integrations.  Backups MAY copy these blobs, but don't have to.
They should only be restored when the associated document is restored.

## Limits

Document and folder paths are distinguished only by the first 942 characters.

The characters allowed in paths are limited to what the provider supports. For MinIO, this is the underlying filesystem characters.
