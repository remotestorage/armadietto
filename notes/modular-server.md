# Modular (New) Server

It's built using Express, so bespoke versions can be implemented by copying appFactory.js and adding new middleware.

There's an NPM module for almost anything worth doing in a Node.js server (albeit, not everything is production-quality).

## Installation

In addition to installing Armadietto, you **MUST** have a server  with an S3-compatible interface.
If your hosting provider doesn't offer S3-compatible storage as a service, you can self-host using any of several open-source servers, on the same machine as Armadietto if you like.

See [S3-compatible Streaming Store](S3-store-router.md) for compatability of various implementations.
[Garage](https://garagehq.deuxfleurs.fr/) is used while developing Armadietto.

## Use

After copying and editing the configuration file (see below), set the S3 environment variables (see [S3-compatible Streaming Store](S3-store-router.md)) to tell
Armadietto how to access storage.
(If you don't set the S3 environment variables, the S3 router will use the public account on `play.min.io`, where the documents & folders can be **read, altered and deleted** by anyone in the world! Also, the Min.IO browser can't list your documents or folders.)

Then run the modular server with the command
```shell
npm run modular
```
or directly with
```shell
node ./bin/www -c ./bin/dev-conf.json
```

The following environment variables are read:
* S3_ENDPOINT
* S3_ACCESS_KEY
* S3_SECRET_KEY
* S3_REGION [defaults to `us-east-1`]
* JWT_SECRET [defaults to `S3_SECRET_KEY`]
* BOOTSTRAP_OWNER [used to create OWNER accounts]
* PORT [overrides `http.port` configuration file value]
* DEBUG [set to log all calls to the S3 server]
* NODE_ENV

For production, you should set the environment variable `NODE_ENV` to `production` and configure systemd (or your OS's equivalent) to start and re-start Armadietto.
See [the systemd docs](../contrib/systemd/README.md).

To add Express modules (such as [express-rate-limit](https://www.npmjs.com/package/express-rate-limit)), edit `bin/www` and `lib/appFactory.js`, or write your own scripts.

## Configuration

Your configuration file *MUST* set `host_identity` to a domain name that points to your server. It doesn't have
to be the canonical name.
Changing `host_identity` will invalidate all grants of access, and make unavailable accounts stored in S3-compatible storage (unless you set `s3.user_name_suffix` to the old value).

The following values in the configuration file must be set:
* `host_identity`
* `basePath` [usually ""]
* `allow_signup`
* `http` [set `http.port` to serve using HTTP]
* `https` [set `https.port` to serve using HTTPS]
* `logging`

The following values in the configuration file are optional:
* `s3.user_name_suffix`

Other value in the configuration files are ignored.

### Customizing `bin/www`

The secret used to generate JWTs must have at least 64 cryptographically random ASCII characters.

The streaming storage handler is an Express Router and does the actual storage.

The `accountMgr` object has methods to create, retrieve, update, list and delete user accounts.
When it is created, it should be passed the streaming storage router, so the accountMgr
can call `storeRouter.allocateUserStorage()`.

They may be the same object (S3-compatible storage can use itself for an accountMgr object, or a different type of accountMgr object).

S3-compatible storage is typically configured using environment variables; see the note [S3-store-router.md](`./S3-store-router.md`) for details.

If your server runs at a path other than root, you *MUST* pass the `basePath` argument to appFactory.

### app.set()

If you call `app.set('forceSSL', ...)` you must also call `app.set('httpsPort')` which is only used for this redirection.

### app.locals

You *MUST* set `app.locals.title` and `app.locals.signup` or the web pages won't render.

## Multiple instances of the modular server

Sessions are stored in memory, so your load balancer must use sticky sessions (session affinity), for `/admin`, `/account` and `/oauth` paths.

## Proxies

Production servers typically outsource TLS to a proxy server — nginx and Apache are both well-documented.
See the note [reverse-proxy-configuration.md](`./reverse-proxy-configuration.md`) for details.
A proxy server can also cache static content. Armadietto sets caching headers to tell caches what they can and can't cache.

If the modular server is behind a proxy, you **MUST** set
`app.set('trust proxy', 1)`

## Operations

### Invitations

Contact URLs are used to identify users, when issuing invitations. Ideally, it should be a secure channel, such as Signal Private Messenger: `sgnl://signal.me/#p/+yourphonenumber`. Often, contact URLs will use the less-secure `mailto:` or `sms:` scheme.

Armadietto can't send invitations itself yet; an admin must send the invitation manually, using their own account.  The Armadietto user interface allows you to send the invite via the system share functionality, or copy and paste from the user interface.
You can send the invite by any means; it's not required that you use the contact info in the Contact URL.
For example, you could send an invite to a person in the same room, using AirDrop or Nearby Share.

If `allow_signup` is set in the configuration file, anyone can *request* an invite.  Admins can list these requests and grant them.

Changing the Contact URL of a user (not implemented yet) will *invalidate all of their passkeys*.

In place of password reset functionality, you re-invite the user.  An invite for an existing account will allow a user to create a passkey on a device where no passkey exists. Issuing an invite **does not invalidate** any existing passkeys. In general, a user will need one invite for each ecosystem (Apple, Google, Microsoft, FIDO hardware key, etc.) they use.

If a user has valid passkeys for more than one account,
the selected passkey will determine which account the user is logged in to.

### Administrators

To create an account with `OWNER` privilege, set the `BOOTSTRAP_OWNER` environment variable to the Contact URL followed by a space and the username. (If a Contact URL doesn't parse as a URL, the system will attempt to parse it as an email address.) Then start or re-start the server. The invite will be written using the store router and the log will contain the path to the blob. (It's in the `adminInvites` directory.)
To re-send the invite, delete the blob in the `adminInvites` directory named with the contactURL.

An account with `OWNER` privilege can invite others to be administrators.  An account with `ADMIN` privilege can invite regular users. At present, there is no way to upgrade a regular user to an administrator, nor an administrator to an owner. :-(

Admins can also see the list of users and list of other admins.

## Development

### Streaming Store Router

A streaming store router is an instance of `Router` that
implements `get`, `put` and `delete` for the path
`'/:id/*'`. It is mounted after `storageCommonRouter`:
```javascript
app.use(`${basePath}/storage`, storageCommonRouter(hostIdentity, jwtSecret));
app.use(`${basePath}/storage`, storeRouter);
```

It also must implement a method
```
router.allocateUserStorage = async function (id, logNotes)
```
which is called by the accountMgr object.

It also must implement methods
```javascript
upsertAdminBlob(path, contentType, content)
readAdminBlob(path)
metadataAdminBlob(path)
deleteAdminBlob(path)
```

which are called by the admin module.

### Account Manager

Accounts are managed by an object with methods
`createUser({ username, contactURL }, logNotes)`,
`deleteUser(username, logNotes)` and
`authenticate ({ username, password }, logNotes)`

`createUser` MUST call `allocateUserStorage(id, logNotes)`
on the streaming store router.

`logNotes` is a Set of strings which methods can append to. The logging middleware will
append everything in `logNotes` to the log entry for the current
request.

The accountMgr object may be the same object as the streaming
store router.

### Logging

A successful request doesn't need extra info to be logged,
unless it's something notable like an account being created.
An unsuccessful request should log enough detail to recreate
why it failed.

Log info is much more helpful when it's clear what request
it's associated with. Code does not call the logger directly. Instead, messages are added to the Set `res.logNotes`.
Multiple pieces of information don't need to be concatenated before adding to `logNotes`.  The logging middleware will
concatenate them when logging the request.
When an error has been thrown, the function `errToMessages`
is useful to extract fields from the error and its cause
(if any), eliminating duplicate messages.

A few activities not associated with requests do call the
logger directly.
