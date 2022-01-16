# Configuring Armadietto as a Daemon with Systemd

As root, or using `sudo`:

1. Copy `armadietto.service` to `/etc/systemd/system/`
2. If Armadietto should run as a user **other** than `armadietto`, edit `User` and `Group` in `armadietto.service`.
3. If your config file is **not** at `/etc/armadietto/conf`, edit `ExecStart` in `armadietto.service`.
4. Run `systemctl daemon-reload`
5. Run `systemctl enable armadietto`
6. Run `systemctl start armadietto`
