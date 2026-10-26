// Runs the Android project's Gradle wrapper with the given tasks, on Windows (gradlew.bat) or
// anywhere else (./gradlew): `node scripts/gradle.mjs assembleDebug`.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const android = fileURLToPath(new URL('../android/', import.meta.url));
const windows = process.platform === 'win32';
// By full path: cmd may not look in the working folder (NoDefaultCurrentDirectoryInExePath).
const wrapper = join(android, windows ? 'gradlew.bat' : 'gradlew');
const result = spawnSync(windows ? `"${wrapper}"` : wrapper, process.argv.slice(2), {
  cwd: android,
  stdio: 'inherit',
  shell: windows,
});
process.exit(result.status ?? 1);
