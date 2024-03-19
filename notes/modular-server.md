# Modular Server

It's built using Express, so bespoke versions can be implemented by copying appFactory.js and adding new middleware.

There's an NPM module for almost anything worth doing in a Node.js server (albeit, not everything is production-quality).

## Configuration

Your configuration file MUST set `host_identity`.
It's typically the domain name of the host.
Changing `host_identity` will invalidate all grants of access, and make unavailable accounts stored in S3-compatible storage (unless you set `s3.user_name_suffix` to the old value).

### Modular Server Factory

The secret used to generate JWTs must have at least 32 cryptographically random ASCII characters.

The account object has methods to create users and check passwords.
The streaming storage handler is Express middleware and does the actual storage.
They may be the same object (as they are for S3-compatible storage).

S3-compatible storage is typically configured using environment variables; see the note for details.

If your server runs at a path other than root, you must pass the `basePath` argument to appFactory.

### app.set()

If you call `app.set('forceSSL', ...)` you must also call `app.set('httpsPort')` which is only used for this redirection.

### app.locals

You MUST set `app.locals.title` and `app.locals.signup` or the web pages won't render.


## Proxies

Production servers typically outsource TLS to a proxy server — nginx and Apache are both well-documented.  A proxy server can also cache static content. Armadietto sets caching headers to tell caches what they can and can't cache.

If the modular server is behind a proxy, you must set
`app.set('trust proxy', 1)`
