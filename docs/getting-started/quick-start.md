# Quick start

The fastest way to see PeckList: one container, data in a Docker volume.

```bash
docker run -d --name pecklist -p 8080:8080 -v pecklist-data:/data -v pecklist-files:/files \
  registry.gitlab.com/killswitch10/pecklist:latest
docker logs pecklist
```

The log shows a box like this, once:

```text
============================================================
  PeckList admin account created
    username: admin
    password: 7mKq...
  Log in and change it. This is shown only once.
============================================================
```

Open <http://localhost:8080>, sign in as `admin` with that password, and choose a new one. A short
setup follows (the address people will use, single sign-on if you want it). You can skip it and
come back from **Admin**.

!!! tip "Missed the password?"
    `docker exec pecklist pecklist admin reset-password` prints a new one.

## Next steps

- Keep it running properly with [Docker Compose](../install/docker-compose.md).
- Put it behind [HTTPS](../install/reverse-proxy.md): browsers only install the app and allow
  offline use on a secure address (or `localhost`).
- Add people under **Admin > Users**, or let them in with [single sign-on](../guides/single-sign-on.md).
- Read [First start](first-start.md) for what the admin account can do.
