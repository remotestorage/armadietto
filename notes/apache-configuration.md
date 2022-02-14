# Configuring Apache as a Reverse Proxy for Armadietto

1. [optional] Set a DNS A record for the new domain name, if you are setting up Armadietto on a new domain name.
2. Ensure your TLS certificate includes the domain name Armadietto be will visible as. (If you don't yet have a certificate, [Let's Encrypt](https://letsencrypt.org/) is a good source.)
3. [optional] Set up a name-based virtual server, if you are setting up Armadietto on a new domain name.
4. Configure your reverse proxy, and have it set the header `x-forwarded-proto` (or `x-forwarded-ssl` or `x-forwarded-scheme`) in the request passed to Armadietto. (Armadietto does not yet support the `Forwarded` header.) The Apache directives are `ProxyPass`, `ProxyPassReverse`, and `RequestHeader`. If you set `timeout` on `ProxyPass`, or `ProxyTimeout`, set it to 30 seconds or more. A name-based virtual server and reverse proxy will resemble:
```
<VirtualHost *:443>
ServerName storage.example.com
DocumentRoot /var/www/remotestorage
SSLEngine on
SSLCertificateFile      /etc/letsencrypt/live/example.com/fullchain.pem
SSLCertificateKeyFile   /etc/letsencrypt/live/example.com/privkey.pem
SSLCertificateChainFile /etc/letsencrypt/live/example.com/fullchain.pem

ProxyPass        "/"  "http://127.0.0.1:8000/"
ProxyPassReverse "/"  "http://127.0.0.1:8000/"
RequestHeader set x-forwarded-proto "https"
RequestHeader unset x-forwarded-ssl
RequestHeader unset x-forwarded-scheme
</VirtualHost>
```
5. Run `armadietto -e` to see a sample configuration file.
6. Create a configuration file at `/etc/armadietto/conf` (or elsewhere). See README.md for values and their meanings.
7. Run `armadietto -c /etc/armadietto/conf`
8. [optional] On Linux systems not protected by CloudFlare, in the Fail2ban configuration files, enable all the predefined jails that start with `apache-`.
