#!/bin/sh
# Adds the Android emulator, a system image with Chrome and one AVD to an SDK that
# android-sdk.sh set up, for the Appium tests (e2e/android/emulator.Dockerfile, e2e/android).
set -eu
: "${ANDROID_HOME:?set ANDROID_HOME}"
: "${ANDROID_AVD_HOME:?set ANDROID_AVD_HOME}"
IMAGE="system-images;android-36;google_apis;x86_64"
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install emulator "$IMAGE" > /dev/null
mkdir -p "$ANDROID_AVD_HOME"
# --force: a run cut off halfway left an AVD that a second try replaces.
echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" --silent create avd --force \
  --name pecklist --package "$IMAGE" --device pixel_7
# A phone with a keyboard attached (Appium types through it), room for the app and its data.
cat >> "$ANDROID_AVD_HOME/pecklist.avd/config.ini" <<'INI'
hw.ramSize=4096
hw.keyboard=yes
disk.dataPartition.size=6G
INI
# Last: the marker that all of the above is done (boot-emulator checks it, not the AVD folder).
touch "$ANDROID_AVD_HOME/.pecklist-ready"
