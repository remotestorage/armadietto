# Configuring Armadietto as a Daemon for OpenWrt

The Armadietto is a Node.JS app and a regular OpenWrt router is too weak to run it.
But some routers like Turris Omnia are powerful enough.

## Install
Your RS server needs to have a public IP with domain and a TLS certificate that is needed for HTTPS.

If you don't have a domain you can use a free https://DuckDNS.org.
See [DDNS client configuration](https://openwrt.org/docs/guide-user/base-system/ddns).

The TLS certificate may be issued with acme.sh.
See [TLS certificates for a server](https://openwrt.org/docs/guide-user/services/tls/certs) for details how to issue a new cert.
We assume that you already issued a cert

To store data you need to mount a disk.
See [Quick Start for Adding a USB drive](https://openwrt.org/docs/guide-user/storage/usb-drives-quickstart). 

In the example it's mounted to /mnt/disk/
Next we need to create a folder to store the user data. Login to OpenWrt with `ssh root@192.168.1.1` and execute:

    mkdir /mnt/disk/armadietto/

Then install Node.JS and NPM:

    opkg update
    opkg install node node-npm

Then install the Armadietto with NPM:

    npm -g i armadietto

Now create a sample config and store to `/etc/armadietto/conf.json`:

    armadietto -e > /etc/armadietto/conf.json

Now edit the generated file with `vi /etc/armadietto/conf.json` and change the following:
* `storage_path` set to `/mnt/disk/armadietto/`
* `http.port` set to `0` to disable the raw unecrypted HTTP.
* `https.enable` set to `true`
* `https.force` set to `true`
* `https.cert` set to `/etc/acme/domainname_ecc/fullchain.cer` where the `domainname` is your domain
* `https.key` set to `/etc/acme/domainname_ecc/domainname.key`
* `logging.stdout` set to `warn`

Optionally you can `https.port` set to default HTTPS `443` if you don't have any other sites on the port.
If you do have then you need to configure a reverse proxy. If you not sure then leave it 4443.

So it should look like:
```json
{
  "allow_signup": true,
  "storage_path": "/srv/armadietto",
  "cache_views": true,
  "http": {
    "host": "0.0.0.0",
    "port": 0
  },
  "https": {
    "enable": true,
    "force": true,
    "host": "0.0.0.0",
    "port": 4443,
    "cert": "/etc/acme/yurt.jkl.mn_ecc/fullchain.cer",
    "key": "/etc/acme/yurt.jkl.mn_ecc/yurt.jkl.mn.key"
  },
  "logging": {
    "log_dir": "logs",
    "stdout": ["warn"],
    "log_files": ["error"]
  },
  "basePath": ""
}
```

Now we need to setup a service. Copy the file `armadietto.sh` into `/etc/init.d/armadietto`.
You can do this with SCP:

    scp contrib/openwrt/armadietto.sh root@192.168.1.1:/etc/init.d/armadietto

Then you can start the service:

    service armadietto start

After than open in a browser your https://domainname:4443/ and signup for a new account.
Then try to use it with some like e.g. https://litewrite.net/
