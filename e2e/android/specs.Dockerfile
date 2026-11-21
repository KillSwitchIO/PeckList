# The Android specs' runner (WebdriverIO), as a compose service in the emulator's network
# (e2e/android/compose.yml, profile "specs"), so CI and a laptop run them the same way and reach
# Appium and the server at 127.0.0.1. Installs only the e2e package, from the lockfile.
FROM node:24-bookworm-slim
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 SKIP_INSTALL_SIMPLE_GIT_HOOKS=1 CI=true
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY web/package.json web/
COPY mobile/package.json mobile/
COPY website/package.json website/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter @pecklist/e2e --ignore-scripts
COPY e2e/tsconfig.json e2e/wdio.android.conf.ts e2e/
COPY e2e/android-specs e2e/android-specs
WORKDIR /repo/e2e
CMD ["pnpm", "test:android"]
