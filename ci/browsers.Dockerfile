# The e2e jobs' image: Node with Debian's Chromium (and its matching driver) and Firefox ESR, so a
# job no longer installs them with apt on every run. Built by the ci-images job (docs/development/ci.md)
# into $CI_REGISTRY_IMAGE/ci/browsers; rebuilt weekly and whenever this file changes.
FROM node:24-bookworm
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends chromium chromium-driver firefox-esr \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
ENV CHROME_BIN=/usr/bin/chromium \
    CHROMEDRIVER_BIN=/usr/bin/chromedriver \
    FIREFOX_BIN=/usr/bin/firefox-esr
