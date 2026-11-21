# The Appium tests' image (e2e/android): a JDK, the emulator's libraries, and Appium with its
# UiAutomator2 driver. It needs /dev/kvm: `docker run --device /dev/kvm`.
#
# The Android SDK, the emulator and the Android 16 system image (with Chrome, for the sign-in
# hand-off's Custom Tab), about 8 GB, are not in the image: boot-emulator installs them on the first
# start into the volume at $ANDROID_HOME (compose.yml), with the one AVD. Removing that volume takes
# all of it away. Baked into the image, they stayed behind in BuildKit's build cache after the image
# itself was removed, and no prune filter could reach them.
FROM node:24-trixie-slim
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends ca-certificates curl openjdk-21-jdk-headless unzip \
       libpulse0 libgl1 libnss3 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 \
       libasound2t64 libdbus-1-3 libxkbfile1 \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_AVD_HOME=/opt/android-sdk/avd \
    APPIUM_HOME=/opt/appium
ENV PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
RUN npm install -g appium@3.9.0 && appium driver install uiautomator2@8.7.3 \
    && npm cache clean --force
COPY scripts/ci/android-sdk.sh scripts/ci/android-emulator.sh /usr/local/share/pecklist/
COPY e2e/android/boot-emulator.sh /usr/local/bin/boot-emulator
EXPOSE 4723
CMD ["boot-emulator"]
