# S3-compatible Streaming Store

Streaming Stores can only be used with the modular server.

You should be able to connect to any S3-compatible service that supports versioning. Tested services include:

* min.io (both self-hosted and cloud)


Configure the store by passing to the constructor the endpoint (host name), access key (admin user name) and secret key (password). For non-Amazon providers, you may need to pass in a port number as well.  You can provide these however you like, but typically they are stored in these environment variables:

* S3_HOSTNAME
* S3_PORT
* S3_ACCESS_KEY
* S3_SECRET_KEY

Creating a client then resembles:

```javascript
const store = new S3(process.env.S3_HOSTNAME,
    process.env.S3_PORT ? parseInt(process.env.S3_PORT) : undefined,
    process.env.S3_ACCESS_KEY, process.env.S3_SECRET_KEY);
```

This one access key is used to create a bucket for each user.
The bucket name is the username.
Buckets can be administered using the service's tools, such as a webapp console or command-line tools.
The bucket can contain non-remoteStorage blobs outside these prefixes:

* remoteStorageBlob/
* remoteStorageAuth/
