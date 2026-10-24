// Runs the Android project's Gradle wrapper with the given tasks, on Windows (gradlew.bat) or
// anywhere else (./gradlew): `node scripts/gradle.mjs assembleDebug`.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const android = fileURLToPath(new URL('../android/', import.meta.url));
const windows = process.platform === 'win32';
const result = spawnSync(windows ? 'gradlew.bat' : './gradlew', process.argv.slice(2), {
  cwd: android,
  stdio: 'inherit',
  shell: windows,
});
process.exit(result.status ?? 1);
