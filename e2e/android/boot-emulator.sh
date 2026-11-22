#!/bin/sh
# Installs the SDK into its volume on the first start, starts the emulator headless, waits for
# Android to boot, readies it for the tests, then runs Appium in the foreground (the container's
# main process). The PeckList server and the mock sign-in provider share this container's network
# (compose.yml): the emulator reaches the server at 10.0.2.2:8080 and, through adb reverse, the
# provider at localhost:8091, the address the server knows it by too.
set -eu
# The marker holds the AVD's version (AVD_VERSION in android-emulator.sh): a volume kept
# (E2E_KEEP=1) from an older one gets the AVD made again, without installing the SDK again.
ready="$ANDROID_AVD_HOME/.pecklist-ready"
avd_version=$(sed -n 's/^AVD_VERSION=//p' /usr/local/share/pecklist/android-emulator.sh)
if [ ! -f "$ready" ]; then
  echo "first start: installing the Android SDK and system image into $ANDROID_HOME"
  sh /usr/local/share/pecklist/android-sdk.sh
  sh /usr/local/share/pecklist/android-emulator.sh
elif [ "$(cat "$ready")" != "$avd_version" ]; then
  echo "the AVD's settings changed: making it again"
  sh /usr/local/share/pecklist/android-emulator.sh
fi
# An emulator stopped by `docker compose rm --stop` (E2E_KEEP=1) leaves its AVD's lock files in the
# volume, and the next start then refuses: "Running multiple emulators with the same AVD". This
# container is the AVD's only user, so they can go.
rm -rf "$ANDROID_AVD_HOME"/pecklist.avd/*.lock
# -wipe-data: every run starts from a fresh phone, also when E2E_KEEP=1 kept the volume (the AVD's
# userdata would otherwise still hold the last run's app, its data, and Chrome signed in).
emulator -avd pecklist -wipe-data -no-window -no-audio -no-boot-anim -no-snapshot -no-metrics \
  -gpu swiftshader_indirect -cores "${EMULATOR_CORES:-4}" -accel on \
  > /tmp/emulator.log 2>&1 &
emulator_pid=$!
# No `adb wait-for-device`: it waits forever when the emulator never starts (a full disk on the
# runner left a stack waiting half an hour). An emulator that stops ends this script, and so the
# container, with its log, so the run fails at once.
booted=0
waited_from=$(date +%s)
for _ in $(seq 1 150); do
  if ! kill -0 "$emulator_pid" 2> /dev/null; then
    echo "The emulator stopped before Android booted:" >&2
    tail -20 /tmp/emulator.log >&2
    exit 1
  fi
  if [ "$(timeout 10 adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then booted=1; break; fi
  sleep 2
done
if [ "$booted" != 1 ]; then
  echo "Android did not boot in $(( $(date +%s) - waited_from )) s" >&2
  tail -40 /tmp/emulator.log >&2
  exit 1
fi
# No animations (steadier tests), and Chrome without its first-run screens, which would cover
# the Custom Tab.
for scale in window_animation_scale transition_animation_scale animator_duration_scale; do
  adb shell settings put global "$scale" 0
done
adb shell 'echo "_ --disable-fre --no-first-run --no-default-browser-check" > /data/local/tmp/chrome-command-line'
adb shell am set-debug-app --persistent com.android.chrome
adb reverse tcp:8091 tcp:8091
echo "emulator ready"
exec appium --address 0.0.0.0 --port 4723
