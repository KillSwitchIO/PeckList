# The Windows installer's build image (PL-132): Inno Setup's compiler under Wine, so the Linux runner
# builds pecklist-setup-<version>-x64.exe (packaging/windows/pecklist.iss). Built by the ci-images
# job into $CI_REGISTRY_IMAGE/ci/innosetup; rebuilt weekly and whenever this file changes.
# The Inno Setup download is pinned by version and SHA-256 (its Authenticode signature, Pyrsys B.V.,
# was checked when the hash was taken). To move to a newer release: download it, check the signature
# (Get-AuthenticodeSignature on Windows), and change both lines.
FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2
ARG INNO_VERSION=7.1.1
ARG INNO_SHA256=8a5a6711c3766a6e5fb74f280ba0e3551e719ce94538d901fdbd1f8f9920b3f0
ENV WINEPREFIX=/opt/wine WINEDEBUG=-all WINEDLLOVERRIDES=mscoree,mshtml=
# Wine's 32-bit half too: a new prefix needs it, even for the 64-bit compiler.
RUN dpkg --add-architecture i386 \
    && apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends wine wine64 wine32:i386 ca-certificates curl xvfb xauth unzip \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    tag="is-$(echo "$INNO_VERSION" | tr . _)"; \
    curl -fsSLo /tmp/innosetup.exe "https://github.com/jrsoftware/issrc/releases/download/$tag/innosetup-$INNO_VERSION-x64.exe"; \
    echo "$INNO_SHA256  /tmp/innosetup.exe" | sha256sum -c -; \
    xvfb-run -a wine /tmp/innosetup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- '/DIR=C:\inno'; \
    wineserver -w; \
    rm /tmp/innosetup.exe; \
    test -f "$WINEPREFIX/drive_c/inno/ISCC.exe"
# iscc <script.iss> [ISCC options]: the command-line compiler.
RUN printf '#!/bin/sh\nexec wine "$WINEPREFIX/drive_c/inno/ISCC.exe" "$@"\n' > /usr/local/bin/iscc && chmod +x /usr/local/bin/iscc
