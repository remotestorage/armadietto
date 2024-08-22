# S3-compatible Streaming Store

Note: S3-compatible storage trades the strong consistency of a file system for higher performance and multi-datacenter capability, so this store only offers eventual consistency.

Streaming Stores like this can only be used with the modular server.

## Compatible S3 Implementations

Tested services include:

### AWS S3

* Fully working

### Garage

* doesn't implement versioning (which would be nice for recovery)
* doesn't implement If-Match for GET, which is not yet used but will be required to support Range requests

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
Buckets can be administered using the service's tools, such as a webapp console or command-line tools.
The bucket **SHOULD NOT** contain non-RS blobs with these prefixes:

* remoteStorageBlob/
* remoteStorageAuth/

## Limits

Document and folder paths are distinguished only by the first 942 characters.

The characters allowed in paths are limited to what the provider supports. For MinIO, this is the underlying filesystem characters.
