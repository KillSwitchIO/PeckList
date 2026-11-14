// What a release is made of, for the jobs that upload its downloads and publish it.

/** Where a download lives in the project's generic package registry. */
export const packageUrl = (api, packageVersion, file) =>
  `${api}/packages/generic/pecklist/${encodeURIComponent(packageVersion)}/${file}`;

/** The Sigstore bundle that signs SHA256SUMS (scripts/ci/sigstore.sh); a release without it is unsigned. */
export const SUMS_BUNDLE = 'SHA256SUMS.sigstore.json';

/** The file sign-image leaves (its artifact) once the image's signature is made and checked. */
export const IMAGE_SIGNED_MARKER = 'IMAGE_SIGNED';

/** A download's name with its version: pecklist-android.apk is pecklist-android-0.8.0.apk. */
export function versionedName(file, version) {
  const parts = /^(pecklist-.+?)(\.tar\.gz|\.zip|\.apk)$/.exec(file);
  return parts ? `${parts[1]}-${version}${parts[2]}` : file;
}

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

Native downloads for Linux and Windows, and the Android app (\`pecklist-android-${version}.apk\`), are below; check them against \`SHA256SUMS\`. The newest
release's files are always at \`${projectUrl}/-/releases/permalink/latest/downloads/<file>\`. Setup, upgrade
steps and every setting are in the [documentation](${projectUrl}/-/tree/main/docs).

### Command line

The \`pecklist-cli-<platform>\` downloads are the command line on its own, for any machine that talks to a
server: \`pecklist login --server https://...\`, then \`pecklist tasks add ...\`. No server and no .NET install
in them; see the [command line docs](${projectUrl}/-/blob/main/docs/reference/cli.md).${signatureText(
    { sums: signed, image: imageSigned, projectUrl },
  )}${
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
