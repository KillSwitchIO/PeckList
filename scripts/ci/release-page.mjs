// What a release is made of, for the jobs that upload its downloads and publish it.

/** Where a download lives in the project's generic package registry. */
export const packageUrl = (api, packageVersion, file) =>
  `${api}/packages/generic/pecklist/${encodeURIComponent(packageVersion)}/${file}`;

/** The release's links for its downloads. Their names keep `latest` download links stable. */
export function downloadLinks(api, packageVersion, files) {
  return files.map((file) => ({
    name: file === 'SHA256SUMS' ? 'SHA256SUMS (checksums)' : file,
    url: packageUrl(api, packageVersion, file),
    direct_asset_path: `/${file}`,
    link_type: file === 'SHA256SUMS' ? 'other' : 'package',
  }));
}

/** The release page's text around the changelog section. */
export function describeRelease({ notes, image, version, prerelease, projectUrl }) {
  return `${notes}

## Install

\`\`\`bash
docker pull ${image}:${version}
\`\`\`

Native downloads for Linux and Windows, and the Android app (\`pecklist-android.apk\`), are below; check them against \`SHA256SUMS\`. The newest
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
