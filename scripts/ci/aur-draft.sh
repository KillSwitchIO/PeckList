#!/bin/sh
# The aur-draft job (PL-132): a final release's AUR folders, made only from sums that are provably
# the pipeline's. The release page's SHA256SUMS sits in the package registry, which any job token of
# the project can write, so its Sigstore bundle is checked first, against the identity
# docs/install/verifying.md gives people: no bundle, or one that does not verify, and there is no
# draft. Then scripts/ci/aur-build.sh writes the folders with those sums, as a plain user (makepkg
# will not run as root, and it writes the .SRCINFO files).
#   sh scripts/ci/aur-draft.sh <tag> [out]     (in an Arch image with base-devel, as root)
set -eu

tag=$1
out=${2:-aur}
root=$(cd "$(dirname "$0")/../.." && pwd)
project=${CI_PROJECT_URL:-https://gitlab.com/killswitch10/pecklist}
identity=https://gitlab.com/killswitch10/pecklist//.gitlab-ci.yml@refs/heads/main
issuer=https://gitlab.com
# The cosign release scripts/ci/sigstore.sh signs with; keep the two in step.
cosign_version=3.1.4
cosign_sha256=424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa

printf '%s\n' "$tag" | grep -Eqx 'v[0-9]+\.[0-9]+\.[0-9]+(\+[0-9A-Za-z.]+)?' ||
  { echo "not a final release tag: $tag" >&2; exit 1; }
version=$(printf '%s' "$tag" | sed 's/^v//; s/+.*//')
downloads="$project/-/releases/$(printf '%s' "$tag" | sed 's/+/%2B/g')/downloads"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
chmod 755 "$work"
curl -fsSLo "$work/SHA256SUMS" "$downloads/SHA256SUMS"
curl -fsSLo "$work/SHA256SUMS.sigstore.json" "$downloads/SHA256SUMS.sigstore.json" ||
  { echo "$tag has no SHA256SUMS.sigstore.json: its sums cannot be trusted, so no draft." >&2; exit 1; }

[ "$(uname -m)" = x86_64 ] || { echo "cosign here is the amd64 build; run this on x86_64" >&2; exit 1; }
curl -fsSLo "$work/cosign" "https://github.com/sigstore/cosign/releases/download/v$cosign_version/cosign-linux-amd64"
echo "$cosign_sha256  $work/cosign" | sha256sum -c - > /dev/null ||
  { echo "cosign $cosign_version does not match its checksum" >&2; exit 1; }
chmod +x "$work/cosign"
"$work/cosign" verify-blob "$work/SHA256SUMS" --bundle "$work/SHA256SUMS.sigstore.json" \
  --certificate-identity "$identity" --certificate-oidc-issuer "$issuer" ||
  { echo "SHA256SUMS of $tag does not verify as the pipeline's: no draft." >&2; exit 1; }

id builder > /dev/null 2>&1 || useradd -m builder
install -d -o builder "$out"
runuser -u builder -- sh "$root/scripts/ci/aur-build.sh" "$work/SHA256SUMS" "$out" "$version" "$tag"
cat "$out/pecklist-bin/PKGBUILD" "$out/pecklist-cli-bin/PKGBUILD"
