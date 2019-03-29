## Running the examples

This repository contains examples using the `stable` and `master` branches of
remoteStorage.js. You'll need to bind `127.0.0.1` to the host `local.dev` for
the demo to work correctly.

Run the example server:

```
$ sudo node server.js
```

Create a user:

```
$ curl -kX POST https://local.dev/signup -d 'username=me' -d 'email=me@example.com' -d 'password=foo'
```

Serve the example app using Node, from `./example`:

```
$ npm run serve 
```

And open the example apps for each version. You may need to dismiss browser
warnings about the self-signed certificate for `local.dev` before the clients
will connect properly.

    open http://localhost:8080/example/index.html
