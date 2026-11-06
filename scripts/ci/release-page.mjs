// What a release is made of, for the jobs that upload its downloads and publish it.

/** Where a download lives in the project's generic package registry. */
export const packageUrl = (api, packageVersion, file) =>
  `${api}/packages/generic/pecklist/${encodeURIComponent(packageVersion)}/${file}`;

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
    return {
      name: file === 'SHA256SUMS' ? 'SHA256SUMS (checksums)' : saved,
      url: packageUrl(api, packageVersion, saved),
      direct_asset_path: `/${file}`,
      link_type: file === 'SHA256SUMS' ? 'other' : 'package',
    };
  });
}

/** The release page's text around the changelog section. */
export function describeRelease({ notes, image, version, prerelease, projectUrl }) {
  return `${notes}

## Install

\`\`\`bash
docker pull ${image}:${version}
\`\`\`

Native downloads for Linux and Windows, and the Android app (\`pecklist-android-${version}.apk\`), are below; check them against \`SHA256SUMS\`. The newest
release's files are always at \`${projectUrl}/-/releases/permalink/latest/downloads/<file>\`. Setup, upgrade
steps and every setting are in the [documentation](${projectUrl}/-/tree/main/docs).${
    prerelease
      ? '\n\nThis is a pre-release: try it, but keep using the latest release for real data.'
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
