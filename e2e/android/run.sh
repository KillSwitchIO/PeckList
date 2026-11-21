#!/bin/sh
# The Android end-to-end run, the same on a laptop (pnpm e2e:android) and in CI (android-e2e):
# build the emulator and specs images, bring up the stack (compose.yml; the emulator installs the
# Android SDK into its volume on the first start), install the APK, run the specs, and always take
# everything down again: the stack's containers, its volumes (the SDK's is about 8 GB) and the two
# images.
#
#   E2E_APK          the debug APK to test (required): mobile/android/app/build/outputs/apk/foss/debug/app-foss-debug.apk
#   PECKLIST_IMAGE   the server image to test against (default pecklist:local, `docker build .`)
#   PECKLIST_OWNER   a name for this run's containers, images, volumes and labels (default e2e)
#   E2E_MIN_FREE_GB  skip, with exit code 77, when Docker has less free space than this (default 12)
#   E2E_KEEP         1 keeps the two images and the SDK volume for the next run (a laptop; never CI)
#
# Needs Docker with /dev/kvm (Linux, or WSL 2 with nested virtualization). Failed tests leave a
# screenshot and the screen's element tree in e2e/screenshots.
set -eu
cd "$(dirname "$0")/../.."

: "${E2E_APK:?set E2E_APK to the debug APK to test}"
[ -f "$E2E_APK" ] || { echo "No APK at $E2E_APK" >&2; exit 1; }
OWNER="${PECKLIST_OWNER:-e2e}"
export PECKLIST_OWNER="$OWNER"
export PECKLIST_IMAGE="${PECKLIST_IMAGE:-pecklist:local}"
export EMULATOR_IMAGE="pecklist-android-emulator:$OWNER"
export SPECS_IMAGE="pecklist-android-specs:$OWNER"
PROJECT="pecklist-android-e2e-$OWNER"
SPECS="$PROJECT-specs"
compose() { docker compose -p "$PROJECT" -f e2e/android/compose.yml --profile specs "$@"; }

# First: room for the SDK, the images and the emulator's disk. Too little skips the run (77, which
# CI shows as a warning) instead of failing it halfway with a full disk.
min_gb="${E2E_MIN_FREE_GB:-12}"
root="$(docker info -f '{{.DockerRootDir}}')"
free_kb="$(docker run --rm --label "pecklist.owner=$OWNER" -v "$root:/docker:ro" busybox:1.37 \
  df -Pk /docker 2>/dev/null | awk 'NR == 2 { print $4 }')" || free_kb=""
if [ -z "$free_kb" ]; then
  echo "Could not read the free space under $root; going on." >&2
elif [ "$free_kb" -lt $((min_gb * 1024 * 1024)) ]; then
  echo "SKIPPED: Docker has $((free_kb / 1024 / 1024)) GB free under $root, and the Android run needs $min_gb GB."
  echo "Free some space (docker system prune) and run it again."
  exit 77
fi
# And KVM, without which the emulator does not start (a runner in a VM without nested
# virtualization, or GitLab's shared runners).
if ! docker run --rm --label "pecklist.owner=$OWNER" --device /dev/kvm busybox:1.37 true >/dev/null 2>&1; then
  echo "SKIPPED: Docker's host has no /dev/kvm, which the Android emulator needs."
  exit 77
fi

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$status" != 0 ]; then
    # The SDK's download and the boot show here; the cleanup below takes the logs with it.
    echo "--- the emulator's log"
    compose logs --no-color --tail 60 emulator 2>/dev/null || true
  fi
  echo "--- cleaning up"
  docker rm -f "$SPECS" >/dev/null 2>&1 || true
  if [ "${E2E_KEEP:-}" = 1 ]; then
    # The server's data still starts empty next time; only the SDK's volume stays.
    compose rm --stop --force --volumes server provider >/dev/null 2>&1 || true
    compose down --remove-orphans --timeout 5 >/dev/null 2>&1 || true
  else
    compose down --volumes --remove-orphans --timeout 5 >/dev/null 2>&1 || true
    docker image rm "$EMULATOR_IMAGE" "$SPECS_IMAGE" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM
# A run killed before its cleanup can leave the specs container behind, under the same name.
docker rm -f "$SPECS" >/dev/null 2>&1 || true

echo "--- images"
docker build --label "pecklist.owner=$OWNER" -f e2e/android/emulator.Dockerfile -t "$EMULATOR_IMAGE" .
docker build --label "pecklist.owner=$OWNER" -f e2e/android/specs.Dockerfile -t "$SPECS_IMAGE" .
docker image inspect "$PECKLIST_IMAGE" >/dev/null 2>&1 || docker pull "$PECKLIST_IMAGE"

echo "--- stack (the first start installs the Android SDK, a few minutes)"
compose up -d --wait emulator server provider
docker cp "$E2E_APK" "$(compose ps -q emulator):/tmp/pecklist.apk"

echo "--- specs"
specs_status=0
compose run --name "$SPECS" specs || specs_status=$?
rm -rf e2e/screenshots/android-*
mkdir -p e2e/screenshots
docker cp "$SPECS:/repo/e2e/screenshots/." e2e/screenshots/ >/dev/null 2>&1 || true
docker rm "$SPECS" >/dev/null 2>&1 || true
if [ "$specs_status" != 0 ]; then
  echo "--- the server's log"
  compose logs --no-color --tail 200 server || true
fi
exit "$specs_status"
