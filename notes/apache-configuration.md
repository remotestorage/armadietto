# Configuring Apache as a Reverse Proxy for Armadietto

1. [optional] Set a DNS A record for a new domain name, if Armadietto will appear as a different host than other websites served by your reverse proxy.
2. Ensure your TLS certificate includes the domain name Armadietto be will visible as.
3. [optional] Set up a name-based virtual server, if Armadietto will appear as a different host than other websites served by your reverse proxy.
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
