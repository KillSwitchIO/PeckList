# PeckList command line

The `pecklist` command line on its own, for any machine that talks to a PeckList server: your
laptop, a CI job, a home automation box. It has no server in it and needs no .NET install.

## Sign in

```bash
pecklist login --server https://tasks.example.com
```

It shows a code. Open the address it prints, signed in to your server as usual, type the code
and approve. Only approve a code you just asked for in your own terminal. To use an API key
instead (for scripts), make one under Settings > Account > API keys and run
`pecklist login --server https://tasks.example.com --token`, or set `PECKLIST_TOKEN`.

## Use it

```bash
pecklist tasks add "Water the plants tomorrow #home !high"
pecklist tasks list --list Home
pecklist tasks done <id>
pecklist help
```

Every command and option is in the documentation's Command line page.
