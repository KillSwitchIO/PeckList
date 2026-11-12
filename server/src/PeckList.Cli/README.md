# PeckList command line

The `pecklist` command line on its own, for any machine that talks to a PeckList server: your
laptop, a CI job, a home automation box. It has no server in it and needs no .NET install. On
Linux it needs OpenSSL (`libssl3`) for `https://` servers, which a minimal container image may lack.

## Sign in

```bash
pecklist login --server https://tasks.example.com
```

It shows a code. Open the address it prints, signed in to your server as usual, type the code
and approve. Only approve a code you just asked for in your own terminal. To use an API key
instead (for scripts), make one under Settings > Account > API keys and run
`pecklist login --server https://tasks.example.com --token`, or set `PECKLIST_TOKEN`. Prefer
those to `--api-key KEY`, which shows in `ps` and in your shell history.

## Use it

```bash
pecklist add "Water the plants tomorrow #home !high"
pecklist tasks list -l Home
pecklist tasks done <id>
pecklist help
pecklist tasks add -h
```

## Shell completion

```bash
# bash (with the bash-completion package)
pecklist completion bash > ~/.local/share/bash-completion/completions/pecklist
# zsh: a file named _pecklist in a folder on $fpath
pecklist completion zsh > "${fpath[1]}/_pecklist"
# fish
pecklist completion fish > ~/.config/fish/completions/pecklist.fish
```

In PowerShell, add `pecklist completion powershell | Out-String | Invoke-Expression` to your
`$PROFILE`.

Every command and option is in the documentation's Command line page.
