# Modular Server

There are two parameters for the modular server: an account module to create and validate users, and streaming storage middleware.  They may be the same object (as they are for S3-compatible storage).

It's built using Express, so bespoke versions can be implemented by copying appFactory.js and adding new middleware.

There's an NPM module for almost anything worth doing in a Node.js server (albeit, not everything is production-quality).

## Proxies

Production servers typically outsource TLS to a proxy server — nginx and Apache are both well-documented.  A proxy server can also cache static content. Armadietto sets caching headers to tell caches what they can and can't cache.

If the modular server is behind a proxy, you must set
`app.set('trust proxy', 1)`
