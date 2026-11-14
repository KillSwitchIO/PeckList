// What a release is made of, for the jobs that upload its downloads and publish it.

/** Where a download lives in the project's generic package registry. */
export const packageUrl = (api, packageVersion, file) =>
  `${api}/packages/generic/pecklist/${encodeURIComponent(packageVersion)}/${file}`;

/** The Sigstore bundle that signs SHA256SUMS (scripts/ci/sigstore.sh); a release without it is unsigned. */
export const SUMS_BUNDLE = 'SHA256SUMS.sigstore.json';

/** The file sign-image leaves (its artifact) once the image's signature is made and checked. */
export const IMAGE_SIGNED_MARKER = 'IMAGE_SIGNED';

/**
 * Where upload-downloads puts each file: every one under <version>-<commit>, and a final release's
 * APK under the plain version too, the one address F-Droid can work out from the version alone
 * (its Binaries: line), to check its own build against ours. A version prepared again replaces it.
 */
export function uploadTargets(files, version, commit) {
  const targets = files.map((file) => ({ file, packageVersion: `${version}-${commit}` }));
  const final = !version.includes('-');
  for (const file of files) {
    if (final && file.endsWith('.apk')) targets.push({ file, packageVersion: version });
  }
  return targets;
}

/**
 * A download's name with its version: pecklist-android.apk is pecklist-android-0.8.0.apk. Linux
 * packages take it where their tools put it: pecklist_amd64.deb is pecklist_0.8.0_amd64.deb, and
 * pecklist.x86_64.rpm is pecklist-0.8.0.x86_64.rpm.
 */
export function versionedName(file, version) {
  const deb = /^(pecklist(?:-cli)?)_(amd64|arm64)\.deb$/.exec(file);
  if (deb) return `${deb[1]}_${version}_${deb[2]}.deb`;
  const rpm = /^(pecklist(?:-cli)?)\.(x86_64|aarch64)\.rpm$/.exec(file);
  if (rpm) return `${rpm[1]}-${version}.${rpm[2]}.rpm`;
  // The Windows installer: pecklist-setup-x64.exe is pecklist-setup-0.8.0-x64.exe.
  if (file === 'pecklist-setup-x64.exe') return `pecklist-setup-${version}-x64.exe`;
  const parts = /^(pecklist-.+?)(\.tar\.gz|\.zip|\.apk|\.AppImage)$/.exec(file);
  return parts ? `${parts[1]}-${version}${parts[2]}` : file;
}

/** The files of a release's downloads folder that go on its page. */
export const isDownload = (file) =>
  /^pecklist-.+\.(tar\.gz|zip|apk|AppImage)$/.test(file) ||
  /^pecklist(-cli)?(_(amd64|arm64)\.deb|\.(x86_64|aarch64)\.rpm)$/.test(file) ||
  file === 'pecklist-setup-x64.exe' ||
  file === 'SHA256SUMS';

/**
 * SHA256SUMS naming each file both ways: a file saved from the release page has the version in its
 * name, and one fetched through a `latest` link, as the install guides do, does not.
 */
export function versionedSums(sums, version) {
  const lines = sums.split('\n').filter(Boolean);
  const named = lines.map((line) => {
    const [hash, file] = line.trim().split(/\s+/);
    return `${hash}  ${versionedName(file.replace(/^\*/, ''), version)}`;
  });
  return `${[...lines, ...named].join('\n')}\n`;
}

/**
 * The release's links for its downloads. People see and save the versioned name, while the stable
 * path keeps `latest` download links working from one release to the next.
 */
export function downloadLinks(api, packageVersion, version, files) {
  return files.map((file) => {
    const saved = versionedName(file, version);
    const names = {
      SHA256SUMS: 'SHA256SUMS (checksums)',
      [SUMS_BUNDLE]: `${SUMS_BUNDLE} (their signature)`,
    };
    return {
      name: names[file] ?? saved,
      url: packageUrl(api, packageVersion, saved),
      direct_asset_path: `/${file}`,
      link_type: file in names ? 'other' : 'package',
    };
  });
}

/**
 * What the page says about signatures (scripts/ci/sigstore.sh). Signing fails open, so the page says
 * plainly when one is missing: that tells "Sigstore was down" apart from "someone removed the bundle".
 * Nothing at all for a release from before signing (a legacy tag rebuild passes neither flag).
 * @param {{ sums?: boolean, image?: boolean, projectUrl: string }} signed
 */
export function signatureText({ sums, image, projectUrl }) {
  if (sums === undefined && image === undefined) return '';
  const check = `To check: [verifying downloads and images](${projectUrl}/-/blob/main/docs/install/verifying.md).`;
  const sumsLine = sums
    ? `\`SHA256SUMS\` is signed by this project's release pipeline with Sigstore (\`${SUMS_BUNDLE}\`).`
    : '`SHA256SUMS` is not signed: signing did not complete when this release was made. It still checks the files.';
  const imageLine = image
    ? 'The image is signed by its digest.'
    : 'The image is not signed: signing did not complete when this release was made.';
  return `\n\n${sumsLine} ${imageLine} ${check}`;
}

/**
 * When a pre-release was really published, for its page: GitLab shows the earlier date cut-release
 * gives it (releasedAtFor), so the latest-release link stays on a full release.
 * @param {string} iso
 */
export const publishedLine = (iso) =>
  `Published ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC. GitLab lists a pre-release just before the newest full release, hence the earlier date and the Historical release badge: that keeps GitLab's latest-release link, which installed servers and the install guides follow, on a full release.`;

/** The release page's text around the changelog section. */
export function describeRelease({
  notes,
  image,
  version,
  prerelease,
  projectUrl,
  signed = undefined,
  imageSigned = undefined,
  publishedAt = new Date().toISOString(),
}) {
  return `${notes}

## Install

\`\`\`bash
docker pull ${image}:${version}
\`\`\`

The downloads are below; check them against \`SHA256SUMS\`. The newest release's files are always at
\`${projectUrl}/-/releases/permalink/latest/downloads/<file>\`. Setup, upgrade steps and every setting are in
the [documentation](https://docs.pecklist.com/).

- **Debian and Ubuntu:** \`pecklist_${version}_amd64.deb\` (the server, as a systemd service) and
  \`pecklist-cli_${version}_amd64.deb\` (the command line), also for arm64.
- **Fedora, RHEL and openSUSE:** \`pecklist-${version}.x86_64.rpm\` and \`pecklist-cli-${version}.x86_64.rpm\`,
  also for aarch64.
- **Windows:** \`pecklist-setup-${version}-x64.exe\` (the server as a Windows service and the command line,
  which is the arm64 build on Windows on ARM). It has no code signature, so SmartScreen asks once, under "More info".
- **Portable:** \`pecklist-server-<platform>-portable\` (the server in a folder, any Linux or Windows) and
  \`pecklist-cli-<platform>-portable\` (the command line as one file, also for Windows on ARM).
- **AppImage:** \`pecklist-server-linux-x64-${version}.AppImage\` (the server, to try on a desktop) and
  \`pecklist-cli-linux-x64-${version}.AppImage\`, also for arm64.
- **Android:** \`pecklist-android-${version}.apk\`.

The command line talks to any server: \`pecklist login --server https://...\`, then \`pecklist tasks add ...\`; see
the [command line docs](https://docs.pecklist.com/reference/cli).${signatureText({
    sums: signed,
    image: imageSigned,
    projectUrl,
  })}${
    prerelease
      ? `\n\nThis is a pre-release: try it, but keep using the latest release for real data. ${publishedLine(publishedAt)}`
      : ''
  }`;
}

/**
 * The link that says which image this release is. The compose repository reads it before production
 * moves, and promote-image copies this digest: name and format are a contract with both.
 */
export const IMAGE_DIGEST_LINK = 'image-digest';

export const imageDigestLink = (image, version, digest) => ({
  name: IMAGE_DIGEST_LINK,
  url: `https://${image}:${version}@${digest}`,
  link_type: 'image',
});

/** The digest a release names, or null. */
export function digestOfRelease(release) {
  const link = release?.assets?.links?.find((each) => each.name === IMAGE_DIGEST_LINK);
  return /@(sha256:[0-9a-f]{64})$/.exec(link?.url ?? '')?.[1] ?? null;
}
