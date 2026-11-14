#!/bin/sh
# The Windows installer (PL-132), from a release's portable Windows downloads: the server folder
# (pecklist-server-win-x64-portable.zip) and the command line for x64 and arm64
# (pecklist-cli-win-*-portable.zip), compiled by Inno Setup under Wine (ci/innosetup.Dockerfile,
# packaging/windows/pecklist.iss) into <out>/pecklist-setup-x64.exe. upload-downloads adds it to
# SHA256SUMS, as it does the APK.
#   sh scripts/ci/windows-installer.sh <version> [dist] [out]    (default out: dist-windows)
# The release page names it pecklist-setup-<version>-x64.exe (scripts/ci/release-page.mjs).
# ISCC: the compiler to run (default iscc, the image's Wine wrapper); the tests give a stand-in.
set -eu

version=${1:?usage: windows-installer.sh <version> [dist] [out]}
dist=$(cd "${2:-dist}" && pwd)
mkdir -p "${3:-dist-windows}"
out=$(cd "${3:-dist-windows}" && pwd)
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for name in pecklist-server-win-x64 pecklist-cli-win-x64 pecklist-cli-win-arm64; do
  [ -f "$dist/$name-portable.zip" ] || { echo "no $name-portable.zip in $dist" >&2; exit 1; }
  unzip -q "$dist/$name-portable.zip" -d "$work"
  [ -d "$work/$name" ] || { echo "$name-portable.zip has no $name folder" >&2; exit 1; }
done
for file in pecklist-server-win-x64/pecklist.exe pecklist-server-win-x64/examples/pecklist.conf \
  pecklist-cli-win-x64/pecklist.exe pecklist-cli-win-arm64/pecklist.exe; do
  [ -f "$work/$file" ] || { echo "the portable downloads have no $file" >&2; exit 1; }
done

# Windows wants a.b.c.d in the file's version resource: the release's numbers, a pre-release's too.
numeric=$(printf '%s' "$version" | sed 's/[-+].*//').0
cp -R "$root/packaging/windows" "$work/script"
# The folder lock, shared with the portable zip's install-service.ps1.
cp "$root/examples/windows/lock-folder.ps1" "$work/script/"

win() { winepath -w "$1"; }
${ISCC:-iscc} /Qp \
  "/DAppVersion=$version" \
  "/DNumericVersion=$numeric" \
  "/DServerDir=$(win "$work/pecklist-server-win-x64")" \
  "/DCliX64=$(win "$work/pecklist-cli-win-x64/pecklist.exe")" \
  "/DCliArm64=$(win "$work/pecklist-cli-win-arm64/pecklist.exe")" \
  "/O$(win "$out")" \
  "$(win "$work/script/pecklist.iss")"

[ -f "$out/pecklist-setup-x64.exe" ] || { echo "Inno Setup made no pecklist-setup-x64.exe" >&2; exit 1; }
echo "Built $out/pecklist-setup-x64.exe for $version"
