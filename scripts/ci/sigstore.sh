#!/bin/sh
# Keyless Sigstore signatures, made with the pipeline's own GitLab identity (PL-009 for the image,
# PL-132 for the downloads). There is no key to keep or leak: Sigstore's certificate says which
# project, file and branch ran the job, and anyone can check a file or an image against that
# (docs/install/verifying.md). Every job that signs uses this script:
#   sh scripts/ci/sigstore.sh blob <file> [bundle]         the bundle defaults to <file>.sigstore.json
#   sh scripts/ci/sigstore.sh image <name>@sha256:<digest>  signed in the image's own registry
# The job needs
#   id_tokens:
#     SIGSTORE_ID_TOKEN:
#       aud: sigstore
# and, for an image, REGISTRY_USER and REGISTRY_PASSWORD (default: the job's CI_REGISTRY_USER and
# CI_REGISTRY_PASSWORD), which go to cosign on stdin.
# Sigstore being down must not hold a release up: signing is tried three times, then the script says
# plainly what is not signed and exits 0, and nothing that should show a signature shows one.
# SIGSTORE_REQUIRED=1 makes that a failure instead. After signing it verifies with the identity
# the docs tell people to check, so a signature that would not verify counts as not signed.
# Runs in POSIX sh: the Node (Debian), Docker and regctl (Alpine) images all have it.
set -eu

COSIGN_VERSION=3.1.4
COSIGN_SHA256_AMD64=424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa
COSIGN_SHA256_ARM64=ade83b7aac62e131cacfe96d958948b2150cc9efec46a570a2649b8e27dedad2

mode=${1:-}
target=${2:-}
case "$mode" in
  blob | image) [ -n "$target" ] || mode= ;;
  *) mode= ;;
esac
if [ -z "$mode" ]; then
  echo "usage: sigstore.sh blob <file> [bundle] | sigstore.sh image <name>@sha256:<digest>" >&2
  exit 2
fi

# Who signed: the pipeline's .gitlab-ci.yml on the default branch, exactly what the docs check.
# Anywhere else (a test on another branch) the check after signing accepts any ref of this project.
issuer=${CI_SERVER_URL:-https://gitlab.com}
project=$issuer/${CI_PROJECT_PATH:-killswitch10/pecklist}//${CI_CONFIG_PATH:-.gitlab-ci.yml}
if [ -n "${SIGSTORE_IDENTITY:-}" ]; then
  who="--certificate-identity=$SIGSTORE_IDENTITY"
elif [ "${CI_COMMIT_BRANCH:-}" = "${CI_DEFAULT_BRANCH:-main}" ]; then
  who="--certificate-identity=$project@refs/heads/${CI_DEFAULT_BRANCH:-main}"
else
  who="--certificate-identity-regexp=^$(printf '%s' "$project" | sed 's/[.]/\\./g')@"
fi

not_signed() {
  echo "NOT SIGNED: $1" >&2
  if [ "${SIGSTORE_REQUIRED:-}" = 1 ]; then exit 1; fi
  exit 0
}

[ -n "${SIGSTORE_ID_TOKEN:-}" ] || not_signed "$target (the job has no SIGSTORE_ID_TOKEN; add id_tokens with aud: sigstore)"

fetch() { # url file
  if command -v curl > /dev/null; then
    curl -fsSL --retry 3 -o "$2" "$1"
  elif command -v wget > /dev/null; then
    wget -q -O "$2" "$1"
  else
    node -e 'fetch(process.argv[1]).then(async (r) => { if (!r.ok) throw new Error(`${r.status}`); require("fs").writeFileSync(process.argv[2], Buffer.from(await r.arrayBuffer())); }).catch((e) => { console.error(e.message); process.exit(1); })' "$1" "$2"
  fi
}

# cosign itself: one release, checked against its pinned checksum. One already on PATH is used only
# when it says it is that release.
cosign=$(command -v cosign || true)
if [ -n "$cosign" ] && ! "$cosign" version 2> /dev/null | grep -Eq "v$COSIGN_VERSION( |$)"; then
  echo "Not using $cosign: it is not cosign $COSIGN_VERSION" >&2
  cosign=
fi
if [ -z "$cosign" ]; then
  case "$(uname -m)" in
    x86_64 | amd64) arch=amd64 sum=$COSIGN_SHA256_AMD64 ;;
    aarch64 | arm64) arch=arm64 sum=$COSIGN_SHA256_ARM64 ;;
    *) not_signed "$target (no cosign build for $(uname -m))" ;;
  esac
  cosign=${TMPDIR:-/tmp}/cosign-$COSIGN_VERSION
  if ! fetch "https://github.com/sigstore/cosign/releases/download/v$COSIGN_VERSION/cosign-linux-$arch" "$cosign" \
    || ! echo "$sum  $cosign" | sha256sum -c - > /dev/null; then
    rm -f "$cosign"
    not_signed "$target (cosign $COSIGN_VERSION could not be downloaded, or did not match its checksum)"
  fi
  chmod +x "$cosign"
fi

# cosign is a Go program and trusts the system's CA bundle. The Node image has none (no
# ca-certificates package), so cosign could not reach Sigstore at all there (0.12.0-rc.1: "x509:
# certificate signed by unknown authority" from tuf-repo-cdn.sigstore.dev on every try). Node
# carries Mozilla's roots, the same list ca-certificates ships: with no system bundle and no
# SSL_CERT_FILE of the job's own, cosign gets Node's. Nothing is installed in a job with the token.
# The files are Go's own list on Linux.
system_ca=
for file in ${SIGSTORE_SYSTEM_CA:-/etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt \
  /etc/ssl/ca-bundle.pem /etc/pki/tls/cacert.pem /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem /etc/ssl/cert.pem}; do
  if [ -s "$file" ]; then
    system_ca=$file
    break
  fi
done
if [ -z "${SSL_CERT_FILE:-}" ] && [ -z "$system_ca" ]; then
  if command -v node > /dev/null && roots=$(mktemp "${TMPDIR:-/tmp}/sigstore-roots.XXXXXX") \
    && trap 'rm -f "$roots"' EXIT \
    && node -e 'require("fs").writeFileSync(process.argv[1], require("tls").rootCertificates.join("\n") + "\n")' "$roots"; then
    export SSL_CERT_FILE="$roots"
    echo "No system CA bundle: cosign uses Node's root certificates" >&2
  else
    echo "No system CA bundle and no node for root certificates: cosign may not reach Sigstore" >&2
  fi
fi

# Three tries, a little apart: Sigstore's services are usually back within a minute.
attempt() { # what, then the command
  what=$1
  shift
  if "$@"; then return 0; fi
  for wait in ${SIGSTORE_RETRY_WAITS:-15 45}; do
    echo "$what failed; trying again in ${wait}s" >&2
    sleep "$wait"
    if "$@"; then return 0; fi
  done
  return 1
}

case "$mode" in
  blob)
    bundle=${3:-$target.sigstore.json}
    [ -f "$target" ] || not_signed "$target (no such file)"
    rm -f "$bundle"
    attempt "Signing $target" "$cosign" sign-blob --yes --bundle "$bundle" "$target" > /dev/null \
      || { rm -f "$bundle"; not_signed "$target (Sigstore refused or did not answer: see above)"; }
    attempt "Checking $target" "$cosign" verify-blob --bundle "$bundle" \
      "$who" --certificate-oidc-issuer "$issuer" "$target" > /dev/null \
      || { rm -f "$bundle"; not_signed "$target (the signature did not verify as ${who#*=})"; }
    echo "Signed $target: $bundle, as ${who#*=}"
    ;;
  image)
    case "$target" in
      *@sha256:*) ;;
      *) not_signed "$target (sign images by digest, name@sha256:...)" ;;
    esac
    registry=${target%%/*}
    printf '%s' "${REGISTRY_PASSWORD:-${CI_REGISTRY_PASSWORD:-}}" \
      | "$cosign" login "$registry" -u "${REGISTRY_USER:-${CI_REGISTRY_USER:-}}" --password-stdin > /dev/null \
      || not_signed "$target (could not log in to $registry)"
    attempt "Signing $target" "$cosign" sign --yes "$target" > /dev/null \
      || not_signed "$target (Sigstore or the registry refused or did not answer: see above)"
    attempt "Checking $target" "$cosign" verify \
      "$who" --certificate-oidc-issuer "$issuer" "$target" > /dev/null \
      || not_signed "$target (the signature did not verify as ${who#*=})"
    echo "Signed $target, as ${who#*=}"
    ;;
esac
