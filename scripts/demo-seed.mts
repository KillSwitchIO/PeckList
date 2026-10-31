// Writes the demo server's seed (PL-117, web/src/demo/seed.ts) as a server backup file.
//
//   node scripts/demo-seed.mts <file> [--today YYYY-MM-DD]
//
// Dates are laid out around --today (default: today, UTC). `punchlist import --shift-dates` moves
// them on to the day of the import, so the seed made with the image stays current every night.
// Accounts come without passwords: DEMO_ACCOUNTS gives them theirs when the server starts.
import { writeFileSync } from 'node:fs';
import { buildDemoSeed } from '../web/src/demo/seed.ts';

const args = process.argv.slice(2);
const at = args.indexOf('--today');
const today = at >= 0 ? args[at + 1] : new Date().toISOString().slice(0, 10);
const out = args.find((arg, i) => !arg.startsWith('--') && i !== at + 1);
if (!out || !today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
  console.error('usage: node scripts/demo-seed.mts <file> [--today YYYY-MM-DD]');
  process.exit(2);
}
const { file, workspace } = buildDemoSeed(today);
writeFileSync(out, JSON.stringify(file));
const tasks = workspace.entities.tasks;
console.error(
  `demo seed for ${today}: ${file.accounts.length} accounts, ${file.entities.length} entities, ` +
    `${tasks.length} tasks (${tasks.filter((t) => t.status === 'open' && !t.deletedAt).length} open), ` +
    `${workspace.entities.lists.length} lists, ${workspace.entities.comments.length} comments -> ${out}`,
);
