#!/bin/sh
# Adds the Android emulator, a system image with Chrome and one AVD to an SDK that
# android-sdk.sh set up, for the Appium tests (e2e/android/emulator.Dockerfile, e2e/android).
set -eu
: "${ANDROID_HOME:?set ANDROID_HOME}"
: "${ANDROID_AVD_HOME:?set ANDROID_AVD_HOME}"
# Raised whenever the AVD's settings below change, so a kept volume makes it again (boot-emulator).
AVD_VERSION=2
IMAGE="system-images;android-36;google_apis;x86_64"
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install emulator "$IMAGE" > /dev/null
mkdir -p "$ANDROID_AVD_HOME"
# --force: a run cut off halfway left an AVD that a second try replaces.
echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" --silent create avd --force \
  --name pecklist --package "$IMAGE" --device pixel_7
# A phone with 4 GB and a keyboard attached (Appium types through it). avdmanager already writes
# both keys ("hw.ramSize = ..."), and the first one wins, so they are replaced, not appended
# (appended, they were ignored). The data partition stays the image's 6 GB: the emulator raises
# anything smaller back to that, and wants 1.2 times it (7.4 GB) free beside the SDK, which
# run.sh's free-space check counts.
config="$ANDROID_AVD_HOME/pecklist.avd/config.ini"
sed -i '/^hw\.ramSize *=/d; /^hw\.keyboard *=/d' "$config"
cat >> "$config" <<'INI'
hw.ramSize=4096
hw.keyboard=yes
INI
# Last: the marker that all of the above is done, with the AVD's version (boot-emulator checks
# it, not the AVD folder).
echo "$AVD_VERSION" > "$ANDROID_AVD_HOME/.pecklist-ready"
