#!/bin/sh
# Installs what the Android build needs into $ANDROID_HOME (cached by CI): Google's command-line
# tools, then the platform and build tools the Capacitor project compiles against. Expects a JDK 21.
set -eu
: "${ANDROID_HOME:?set ANDROID_HOME}"
CMDLINE_TOOLS=commandlinetools-linux-16111833_latest.zip
if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  tmp=$(mktemp -d)
  curl -sSfL -o "$tmp/tools.zip" "https://dl.google.com/android/repository/$CMDLINE_TOOLS"
  unzip -q "$tmp/tools.zip" -d "$tmp"
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -rf "$tmp"
fi
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
yes | "$SDKMANAGER" --licenses > /dev/null 2>&1 || true
"$SDKMANAGER" --install "platforms;android-36" "build-tools;36.0.0" "platform-tools" > /dev/null
