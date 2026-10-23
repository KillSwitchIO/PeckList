// Fails when the version differs between the web app and the server, or (in a tag pipeline)
// between the code and the tag being released.
//   node scripts/check-version.mjs [tag]

import { parseTag, readVersions } from './versions.mjs';

const found = readVersions();
const versions = new Set(found.map((each) => each.version));
let ok = true;
if (versions.size !== 1) {
  console.error('The version differs between files:');
  for (const { file, version } of found) console.error(`  ${version}  ${file}`);
  ok = false;
}
const tag = process.argv[2] ?? process.env.CI_COMMIT_TAG;
if (ok && tag) {
  const { version } = parseTag(tag);
  if (!versions.has(version)) {
    console.error(`Tag ${tag} releases ${version}, but the code says ${[...versions][0]}.`);
    console.error('Tag the commit that `pnpm release` made.');
    ok = false;
  }
}
if (!ok) process.exit(1);
console.log(`Version ${[...versions][0]}${tag ? ` matches ${tag}` : ''}.`);
