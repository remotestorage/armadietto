# armadietto-example

This repository contains an example using [remoteStorage.js](https://github.com/remotestorage/remotestorage.js) against the [armadietto remoteStorage server](https://github.com/remotestorage/armadietto).

## Getting Started

In a terminal:

```
$ cd $ARMADIETTOT_REPO/example
$ npm install
```

Where $ARMADIETTOT_REPO is the root where you synced the [armadietto repo](https://github.com/remotestorage/armadietto).

To run the example server:

```
$ npm run start
```

The armadietto server starts on port 443.

Leave the terminal running the server as is.

In a *new* terminal host the example application:

```
$ npm run serve 
```

The example application is now available on port 8080.

And open the example appn. You may need to dismiss browser
warnings about the self-signed certificate for `localhost` before the clients
will connect properly.

    open http://localhost:8080/index.html

## Create a User

### Using Widget

The example app shows the [remotestorage-widget](https://github.com/remotestorage/remotestorage-widget) integration.

The easiest way to create a user is to use the widget.  To create user 'tester' click the widget and enter:

    tester@localhost:443

Click `Connect`.  You'll be taken to an on-boarding site served by your localhost *armadietto*.

Click `Sign Up` in upper right corner.

There is no automated redirection back to the example application at this point, reload it:

    open http://localhost:8080/index.html

### Using Example App and API

```
$ curl -kX POST https://local.dev/signup -d 'username=me' -d 'email=me@example.com' -d 'password=foo'
```
