# S3-compatible Streaming Store

Streaming Stores can only be used with the modular server.

You should be able to connect to any S3-compatible service that supports versioning. Tested services include:

Tested working implementations:

* AWS S3

Tested working with caveats

* OpenIO

Incompatible implementations:

* min.io (both self-hosted and cloud)


Configure the store by passing to the constructor the endpoint (host name, and port if not 9000), access key (admin user name) and secret key (password). (If you don't pass any arguments, S3 will use the public account on `play.min.io`, where the files can be **read, altered and deleted** by anyone in the world. It's also incompatible.) If you're using a AWS and a region other than `us-east-1`, include that as a fourth argument.  You can provide these however you like, but typically they are stored in these environment variables:

* S3_ENDPOINT
* S3_ACCESS_KEY
* S3_SECRET_KEY

For AWS, you must also pass a fifth argument — a user name suffix so bucket names don't collide with other users. By default, this is a dash plus `conf.domain_name`, but you can set `conf.user_name_suffix`.

Creating an app server then resembles:

```javascript
const s3handler = new S3Handler(process.env.S3_ENDPOINT,
    process.env.S3_ACCESS_KEY, process.env.S3_SECRET_KEY);
const app = require('../../lib/appFactory')(s3handler, s3handler);
```

Https is used if the endpoint is not localhost.  If you must use http, you can include the scheme in the endpoint: `http://myhost.example.org`.

This one access key is used to create a bucket for each user.
The bucket name is the username.
If other buckets are created at that endpoint, those bucket names will be unavailable as usernames.
Buckets can be administered using the service's tools, such as a webapp console or command-line tools.
The bucket **MAY** contain non-remoteStorage blobs outside these prefixes:

* remoteStorageBlob/
* remoteStorageAuth/
