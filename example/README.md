# armadietto-example

This repository contains an example of using both the [remotestorage HTTP APIs](https://tools.ietf.org/id/draft-dejong-remotestorage-12.txt) directly as well as abstracted with the [remoteStorage.js](https://github.com/remotestorage/remotestorage.js) library; both, against the [armadietto remoteStorage server](https://github.com/remotestorage/armadietto).

## Getting Started

In a terminal:

```
$ cd $ARMADIETTO_REPO/example
$ npm install
```

Where $ARMADIETTO_REPO is the root where you synced the [armadietto repo](https://github.com/remotestorage/armadietto).

To run the example server:

```
$ npm run start
```

The armadietto server starts on port 8000.

Leave the terminal running the server as is.

In a *new* terminal host the example application:

```
$ npm run serve 
```

The example application is now available on port 8080.

Now open the example app. You may need to dismiss browser
warnings about the self-signed certificate for `localhost` before the clients
will connect properly.

    open http://localhost:8080

## About the App Layout

Please read the text in the lower-right pane of the application.

The same text is available here: [ignore/welcome.txt](ignore/welcome.txt).

## Create a User

### Using Widget

The example app shows the [remotestorage-widget](https://github.com/remotestorage/remotestorage-widget) integration.

The easiest way to create a user is to use the widget.  To create user 'tester' click the widget and enter:

    tester@localhost:8000

Click `Connect`.  You'll be taken to an on-boarding site served by your localhost *armadietto*.

Click `Sign Up` in upper right corner.

There is no automated redirection back to the example application at this point, reload it:

    open http://localhost:8080

### Using "GOTO authDialogUrl (and redirect back)" Use Case

First we need to fill out some configuration fields in the app.

For *server* put in `http://localhost:8000`.

For *user* type in the user's name, e.g. `tester`.

Click *run getWebFinger()* in *GET /.well-known/webfinger* use-case.  The *remotestorageHref* field should be filled in.  

All fields should now be filled in the *GOTO authDialogUrl (and redirect back)* use-case.

Click *run gotoAuth()* to go to the *armadietto* server's onboarding/login page.

Click `Sign Up` in upper right corner.

There is no automated redirection back to the example application at this point, reload it:

    open http://localhost:8080

## Login

Once a user is setup (above) a login involves the same steps as creating a user (above) except the password is entered when asked for, instead of clicking on `Sign Up`.

You're logged in when all the fields including a *token* are filled in at the top of the app:

* *server*
* *user*
* *token*
* *scope*

Note that going through the login flow will redirect you back to the app with the *token* filled in.

## Use [remotestorage HTTP APIs](https://tools.ietf.org/id/draft-dejong-remotestorage-12.txt) Directly

Ensure you're logged in: either through *widget* or manually.

To work with data using [remotestorage HTTP APIs](https://tools.ietf.org/id/draft-dejong-remotestorage-12.txt) go to the *DATA over HTTP * /storage* use-case.

Everything will be done with this use-case.

Click on the use-case title to expand instructions.

Play around with the values and observe the log (top-right pane).  Click on interesting log traces to go to the source code (bottom-right pane).

## Use [remoteStorage.js](https://github.com/remotestorage/remotestorage.js)

Ensure you're logged in: either through *widget* or manually.

To work with data using [remoteStorage.js](https://github.com/remotestorage/remotestorage.js) go to the *DATA over remoteStorage.js* use-case.

Everything will be done with this use-case.

Click on the use-case title to expand instructions.

Play around with the values and observe the log (top-right pane).  Click on interesting log traces to go to the source code (bottom-right pane).
