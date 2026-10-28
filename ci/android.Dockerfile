# The Android jobs' image: Node, a JDK 21 and the Android SDK pieces the Capacitor project compiles
# against (scripts/ci/android-sdk.sh), baked in so a job neither installs them nor restores a
# 60 000-file cache. Built by the ci-images job into $CI_REGISTRY_IMAGE/ci/android; rebuilt weekly
# and whenever this file or android-sdk.sh changes. Gradle's own downloads stay in the job cache.
FROM node:24-trixie
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends openjdk-21-jdk-headless unzip \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
ENV ANDROID_HOME=/opt/android-sdk
COPY scripts/ci/android-sdk.sh /tmp/android-sdk.sh
RUN sh /tmp/android-sdk.sh && rm /tmp/android-sdk.sh
