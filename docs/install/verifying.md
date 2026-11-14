# Verifying downloads and images

Releases are signed by PeckList's own release pipeline with [Sigstore](https://www.sigstore.dev/).
There is no key to trust or look after: the signature's certificate names the GitLab project, its
pipeline file and the branch that ran it, and the signature is recorded in Sigstore's public
transparency log. A check that passes means the file or image came from PeckList's pipeline on
`main`, unchanged.

You need [cosign](https://docs.sigstore.dev/cosign/system_config/installation/) 3 or later.

Every check below names the same signer:

- identity: `https://gitlab.com/killswitch10/pecklist//.gitlab-ci.yml@refs/heads/main`
- issuer: `https://gitlab.com`

## Downloads

One signature covers every download: it signs `SHA256SUMS`, and `SHA256SUMS` lists every file on the
release (the server and command line for each platform and the Android app). Check the signature, then
the files against it:

```bash
BASE=https://gitlab.com/killswitch10/pecklist/-/releases/permalink/latest/downloads
curl -LO "$BASE/SHA256SUMS" -LO "$BASE/SHA256SUMS.sigstore.json"
cosign verify-blob SHA256SUMS --bundle SHA256SUMS.sigstore.json \
  --certificate-identity https://gitlab.com/killswitch10/pecklist//.gitlab-ci.yml@refs/heads/main \
  --certificate-oidc-issuer https://gitlab.com
sha256sum --check --ignore-missing SHA256SUMS
```

`Verified OK` from cosign, then `OK` for each file you downloaded, means you have what the pipeline
built. For a particular release, take both files from its
[release page](https://gitlab.com/killswitch10/pecklist/-/releases) instead.

## Images

The image is signed by its digest, so every tag that points at it (the version, `0.2`, `latest`, and
the copies on Docker Hub) carries the same signature:

```bash
cosign verify registry.gitlab.com/killswitch10/pecklist:latest \
  --certificate-identity https://gitlab.com/killswitch10/pecklist//.gitlab-ci.yml@refs/heads/main \
  --certificate-oidc-issuer https://gitlab.com
```

To pin what you checked, run the image by the digest cosign printed
(`registry.gitlab.com/killswitch10/pecklist@sha256:...`) rather than by a tag, which can move.
`edge` and `sha-` builds are not signed: only releases are.

## When a release has no signature

Every release page made since signing was added says, under **Install**, whether its `SHA256SUMS`
and its image are signed. Signing never holds a release up: if signing did not complete while one
was made (Sigstore down, say), its page says that part is not signed, and `SHA256SUMS` still checks
the files over HTTPS from the project's own page. Releases from before signing say nothing about it,
and neither does a release rebuilt the old way from its tag, whose page and image are not signed.

**If a release page says it is signed and `SHA256SUMS.sigstore.json` is missing, or a check above
fails, don't use the files or the image.** Report it as a [security problem](../guides/security.md#reporting-a-vulnerability).
