// The demo server's seed (PL-117): three people who share lists, as a whole-server backup that
// `pecklist import` loads into an empty database. Built with the app's own core operations, so
// every entity is what the app itself would write. Grown from the demo data of 2026-10-23.
// `scripts/demo-seed.mts` writes it; Node runs this file as it is, so only erasable TypeScript here.
import { HlcClock } from '../core/hlc.ts';
import { updateEntity } from '../core/ops.ts';
import { putEntity, requireEntity } from '../core/collections.ts';
import { createWorkspace } from '../core/workspace.ts';
import {
  createTask,
  deleteTask,
  setPinned,
  setTaskProgress,
  setTaskStatus,
} from '../core/tasks.ts';
import { createList } from '../core/lists.ts';
import { createTag } from '../core/tags.ts';
import { shareList } from '../core/sharing.ts';
import { addComment } from '../core/comments.ts';
import { createSavedFilter } from '../core/savedFilters.ts';
import { createEntity } from '../core/ops.ts';
import { CURRENT_SCHEMA_VERSION } from '../core/migrations.ts';

import type { WorkspaceFile } from '../core/types.ts';

/** The names `DEMO_ACCOUNTS` gives passwords to. */
export const DEMO_USERNAMES = ['demo-sam', 'demo-alex', 'demo-jordan'] as const;

export interface DemoSeed {
  /** The `pecklist-server-backup` document. */
  file: {
    format: 'pecklist-server-backup';
    schemaVersion: number;
    exportedAt: string;
    accounts: { id: string; username: string; passwordHash: null; role: 'user' }[];
    entities: { collection: string; ownerId: string; seq: number; entity: unknown }[];
  };
  /** Everyone's entities in one workspace, for checking them against the schema. */
  workspace: WorkspaceFile;
}

/**
 * The seed with its dates laid out around <today> (YYYY-MM-DD). The same day gives the same file.
 * `pecklist import --shift-dates` moves the dates on to the day of the import.
 */
export function buildDemoSeed(TODAY: string): DemoSeed {
  // --- deterministic randomness: the same day gives the same file ---------------------------------
  let seed = 20261023;
  function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const chance = (p: number) => rand() < p;
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  // --- time ---------------------------------------------------------------------------------------
  const ZONE = 'UTC';
  const DAY = 86_400_000;
  // Midnight UTC: an import later that day (the reset) finds nothing made after it.
  const NOW = Date.parse(`${TODAY}T00:00:00.000Z`);
  let clockMs = NOW - 120 * DAY;
  const at = (ms: number) => {
    clockMs = ms;
  };
  const daysAgo = (days: number, hour = between(7, 20)) =>
    NOW - days * DAY - (21 - hour) * 3_600_000 - between(0, 59) * 60_000;
  function addDays(date: string, days: number): string {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // --- ids -----------------------------------------------------------------------------------------
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function ulid(ms: number): string {
    let time = '';
    let value = ms;
    for (let i = 0; i < 10; i++) {
      time = CROCKFORD[value % 32] + time;
      value = Math.floor(value / 32);
    }
    let random = '';
    for (let i = 0; i < 16; i++) random += CROCKFORD[Math.floor(rand() * 32)];
    return time + random;
  }
  const ids = { next: () => ulid(clockMs) };

  // --- people: the names DEMO_ACCOUNTS gives passwords to ------------------------------------------
  const people = {
    sam: { id: ulid(NOW - 130 * DAY), username: 'demo-sam', name: 'Sam Rivera', color: '#A8D5BA' },
    alex: { id: ulid(NOW - 129 * DAY), username: 'demo-alex', name: 'Alex Chen', color: '#C3B1E1' },
    jordan: {
      id: ulid(NOW - 128 * DAY),
      username: 'demo-jordan',
      name: 'Jordan Patel',
      color: '#F7D488',
    },
  };
  type Who = keyof typeof people;
  const clock = new HlcClock({ node: 'demo01', now: () => Math.max(clockMs, NOW - 200 * DAY) });
  const ctxOf = (who: Who) => ({
    clock,
    ids,
    userId: people[who].id,
    origin: 'local' as const,
    now: () => clockMs,
  });
  const ctx = ctxOf('sam');

  // One workspace holds everyone's entities; the backup gives each to whoever created it.
  at(NOW - 120 * DAY);
  let ws = createWorkspace(ctx, { handle: people.sam.username, displayName: people.sam.name });
  ws = putEntity(
    ws,
    'users',
    updateEntity(ctx, ws.entities.users[0]!, { avatarColor: people.sam.color }),
  );
  const inboxOf: Record<Who, string> = { sam: ws.entities.lists[0]!.id, alex: '', jordan: '' };
  for (const who of ['alex', 'jordan'] as const) {
    const p = people[who];
    const c = ctxOf(who);
    const own = createWorkspace(c, { handle: p.username, displayName: p.name });
    const user = updateEntity(c, own.entities.users[0]!, { avatarColor: p.color });
    ws = putEntity(ws, 'users', user);
    ws = putEntity(ws, 'lists', own.entities.lists[0]!);
    ws = putEntity(ws, 'settings', own.entities.settings[0]!);
    inboxOf[who] = own.entities.lists[0]!.id;
  }
  // Everyone is friends with everyone, so lists can be shared both ways.
  for (const [a, b] of [
    ['sam', 'alex'],
    ['sam', 'jordan'],
    ['alex', 'jordan'],
  ] as const) {
    at(NOW - between(100, 118) * DAY);
    ws = putEntity(
      ws,
      'friendships',
      createEntity(ctxOf(a), { userA: people[a].id, userB: people[b].id, state: 'accepted' }),
    );
  }

  // --- tags ----------------------------------------------------------------------------------------
  const tagNames = [
    'home/yard',
    'home/repairs',
    'home/cleaning',
    'errands',
    'waiting',
    'someday',
    'quick',
    'deep-work',
    'calls',
    'money',
    'kids',
    'health',
    'research',
  ];
  const tag: Record<string, string> = {};
  for (const name of tagNames) {
    const made = createTag(ctx, ws, name);
    ws = made.workspace;
    tag[name] = made.tag.id;
  }
  for (const t of ws.entities.tags) tag[t.name] ??= t.id;

  // --- lists ---------------------------------------------------------------------------------------
  type Spec = {
    key: string;
    name: string;
    color: string;
    icon: string | null;
    owner: Who;
    shareWith?: [Who, 'editor' | 'viewer'][];
  };
  const listSpecs: Spec[] = [
    {
      key: 'household',
      name: 'Household',
      color: '#A7C7E7',
      icon: '🏠',
      owner: 'sam',
      shareWith: [['alex', 'editor']],
    },
    {
      key: 'groceries',
      name: 'Groceries',
      color: '#A9D18E',
      icon: '🛒',
      owner: 'sam',
      shareWith: [
        ['alex', 'editor'],
        ['jordan', 'editor'],
      ],
    },
    { key: 'work', name: 'Work', color: '#E8A87C', icon: '💼', owner: 'sam' },
    { key: 'health', name: 'Health', color: '#F4B6C2', icon: '💪', owner: 'sam' },
    { key: 'reading', name: 'Reading list', color: '#B5A886', icon: '📚', owner: 'sam' },
    {
      key: 'trip',
      name: 'Colorado trip',
      color: '#F6C177',
      icon: '🏔️',
      owner: 'sam',
      shareWith: [
        ['alex', 'editor'],
        ['jordan', 'viewer'],
      ],
    },
    { key: 'move', name: 'Old apartment move', color: '#B8BCC4', icon: '📦', owner: 'sam' },
    {
      key: 'garden',
      name: 'Garden',
      color: '#8CC084',
      icon: '🌱',
      owner: 'alex',
      shareWith: [['sam', 'editor']],
    },
    {
      key: 'bookclub',
      name: 'Book club',
      color: '#E6B89C',
      icon: '📖',
      owner: 'jordan',
      shareWith: [
        ['sam', 'viewer'],
        ['alex', 'editor'],
      ],
    },
    {
      key: 'game',
      name: 'Game night',
      color: '#D98880',
      icon: '🎲',
      owner: 'jordan',
      shareWith: [
        ['alex', 'editor'],
        ['sam', 'editor'],
      ],
    },
  ];
  const list: Record<string, { id: string; spec: Spec }> = {};
  for (const who of Object.keys(people) as Who[]) {
    list[`inbox-${who}`] = {
      id: inboxOf[who],
      spec: { key: `inbox-${who}`, name: 'Mess Drawer', color: '', icon: null, owner: who },
    };
  }
  for (const spec of listSpecs) {
    at(NOW - between(90, 118) * DAY);
    const c = ctxOf(spec.owner);
    const made = createList(c, ws, { name: spec.name, color: spec.color, icon: spec.icon });
    ws = made.workspace;
    for (const [who, role] of spec.shareWith ?? []) {
      ws = shareList(c, ws, made.list.id, `user:${people[who].id}`, role);
    }
    list[spec.key] = { id: made.list.id, spec };
  }

  // --- tasks ---------------------------------------------------------------------------------------
  type T = {
    title: string;
    notes?: string;
    tags?: string[];
    sub?: (string | { title: string; sub: string[] })[];
  };
  const S = (title: string, tags?: string[], notes?: string, sub?: T['sub']): T => ({
    title,
    ...(tags ? { tags } : {}),
    ...(notes ? { notes } : {}),
    ...(sub ? { sub } : {}),
  });

  const plans: Record<string, T[]> = {
    'inbox-sam': [
      S('Call the dentist about the crown', ['calls', 'health']),
      S('Renew car registration', ['errands', 'money']),
      S('Return the boots', ['errands']),
      S('Text Mike about Saturday'),
      S('Cancel the unused streaming trial', ['money', 'quick']),
      S('Back up phone photos', ['quick']),
      S('Find the warranty for the dishwasher'),
      S('Sharpen kitchen knives'),
      S('Pick up dry cleaning', ['errands']),
      S('Print boarding passes', ['quick']),
      S('Schedule oil change', ['errands']),
      S('Write thank-you note to Grandma'),
      S('Replace smoke detector batteries', ['home/repairs']),
      S('Sign permission slip', ['kids', 'quick']),
      S('Donate old clothes', ['errands']),
      S('Pay the water bill', ['money']),
      S('Look at refinancing rates', ['money', 'research']),
      S('Book haircut', ['calls']),
      S('Buy a birthday gift for Alex', ['money']),
      S('Fix the squeaky bedroom door', ['home/repairs', 'quick']),
      S('Plan date night', ['someday']),
      S('Unsubscribe from promo emails', ['quick']),
      S('Look up CPR class dates', ['health', 'research']),
    ],
    'inbox-alex': [
      S('Renew the passport', ['errands']),
      S('Call the bike shop', ['calls']),
      S('Order new running socks', ['money', 'quick']),
      S('Back up the laptop', ['quick']),
      S('Fix the bike chain', ['home/repairs']),
      S('Plan the weekend hike', ['someday']),
    ],
    'inbox-jordan': [
      S('Pay the phone bill', ['money']),
      S('Pick up the package', ['errands']),
      S('Email the landlord', ['calls']),
      S('Clean the fish tank', ['home/cleaning']),
      S('Book the vet', ['calls']),
    ],
    household: [
      S('Clean gutters', ['home/yard'], 'Ladder is in the garage. **Wear gloves.**'),
      S('Deep clean the fridge', ['home/cleaning']),
      S(
        'Fix leaky bathroom faucet',
        ['home/repairs'],
        'Probably the cartridge. Model number under the sink.',
        [
          'Buy a replacement cartridge',
          'Shut off the water',
          'Swap the cartridge',
          'Check for drips the next day',
        ],
      ),
      S('Change furnace filter', ['home/repairs', 'quick']),
      S('Mow the lawn', ['home/yard']),
      S('Rake leaves', ['home/yard']),
      S('Winterize the sprinklers', ['home/yard'], undefined, [
        'Turn off the main valve',
        'Blow out the lines',
        'Insulate the backflow preventer',
      ]),
      S('Plan the holiday menu', [], '- [ ] Main dish\n- [ ] Sides\n- [x] Who brings pie'),
      S('Hang the new shelves in the office', ['home/repairs']),
      S('Schedule chimney sweep', ['calls']),
      S('Wash the windows', ['home/cleaning']),
      S('Replace the porch light', ['home/repairs']),
      S('Vacuum the car', ['home/cleaning']),
      S('Sort the mail pile', ['quick']),
      S('Clean the dryer vent', ['home/cleaning']),
      S('Restock the first aid kit', ['health']),
      S('Get quotes for a new water heater', ['money', 'calls'], undefined, [
        'Call two plumbers',
        'Compare tank vs tankless',
      ]),
      S('Organize the pantry', ['home/cleaning']),
      S('Test the sump pump', ['home/repairs']),
      S("Kids' fall clothes swap", ['kids']),
      S('Clean the oven', ['home/cleaning']),
      S('Put up holiday lights', ['home/yard']),
      S('Replace the shower caulk', ['home/repairs']),
      S('Paint the guest room', ['home/repairs'], 'Color: *Agreeable Gray*.', [
        'Pick paint',
        'Tape the trim',
        'First coat',
        'Second coat',
      ]),
      S('Plan the garage sale', [], undefined, [
        'Pick a date',
        'Post on the neighborhood board',
        'Price everything',
      ]),
      S('Install the smart thermostat', ['home/repairs']),
      S('Fix the wobbly dining chair', ['home/repairs', 'quick']),
      S('Label the breaker box', ['home/repairs']),
      S("Set up the kids' homework station", ['kids']),
    ],
    work: [
      S('Prepare the Q4 planning deck', ['deep-work']),
      S('Review the pull request from Priya', ['quick']),
      S('1:1 notes for Monday'),
      S('Fix the flaky integration test', ['deep-work']),
      S('Write the incident postmortem', ['deep-work'], undefined, [
        'Timeline',
        'Root cause',
        'Action items',
        'Share with the team',
      ]),
      S('Update the on-call runbook'),
      S('Expense the conference hotel', ['money', 'quick']),
      S('Answer the security questionnaire'),
      S('Plan the team offsite', [], undefined, [
        'Pick a venue',
        'Send the survey',
        'Book the dinner',
      ]),
      S('Interview loop for the backend role', ['calls']),
      S('Draft the API deprecation notice'),
      S('Clean up stale feature flags', ['quick']),
      S('Benchmark the search service', ['research', 'deep-work']),
      S('Write the performance self-review', ['deep-work']),
      S('Sync with design on the settings page', ['calls']),
      S('Triage the bug backlog', ['quick']),
      S('Onboard the new intern', [], undefined, ['Laptop', 'Accounts', 'First-week plan']),
      S('Prepare the demo for Friday', ['deep-work']),
      S('Book travel for the summit', ['money']),
      S('Review the cloud bill', ['money', 'research']),
      S('Document the release process'),
      S('Accessibility audit of the app', ['research']),
      S('Write the quarterly goals update'),
      S('Ship the dark mode toggle'),
    ],
    groceries: [
      'Eggs',
      'Milk',
      'Bananas',
      'Coffee beans',
      'Bread',
      'Chicken thighs',
      'Spinach',
      'Greek yogurt',
      'Rice',
      'Onions',
      'Garlic',
      'Tortillas',
      'Cheddar',
      'Apples',
      'Pasta',
      'Tomato sauce',
      'Butter',
      'Olive oil',
      'Peanut butter',
      'Oatmeal',
      'Avocados',
      'Lemons',
      'Frozen peas',
      'Paper towels',
      'Dish soap',
      'Salmon',
      'Potatoes',
      'Carrots',
      'Broccoli',
      'Ice cream',
    ].map((title) => S(title)),
    health: [
      S('Book the annual physical', ['health', 'calls']),
      S('Run 5k three times this week', ['health']),
      S('Refill the prescription', ['health', 'errands']),
      S('Meal prep Sunday', ['health']),
      S('Get the flu shot', ['health', 'errands']),
      S('Try the new climbing gym', ['health', 'someday']),
      S('Replace running shoes', ['health', 'money']),
      S('Book the eye exam', ['health', 'calls']),
      S('Sign up for the fun run', ['health']),
      S('Buy a foam roller', ['health', 'money']),
      S('Plan a hike', ['health', 'someday']),
      S('Bike to work on Friday', ['health']),
    ],
    reading: [
      'Project Hail Mary',
      'The Pragmatic Programmer',
      'Designing Data-Intensive Applications',
      'The Hobbit (with the kids)',
      'Atomic Habits',
      'Deep Work',
      'The Martian',
      'Thinking, Fast and Slow',
      'Dune Messiah',
      'Range',
      'Shape Up',
      'A Philosophy of Software Design',
      'The Wind in the Willows',
    ].map((title) => S(`Read: ${title}`, chance(0.4) ? ['someday'] : [])),
    trip: [
      S('Book flights to Denver', ['money']),
      S('Reserve the cabin in Estes Park', ['money', 'calls']),
      S('Plan the national park days', ['research'], undefined, [
        'Trail Ridge Road',
        'Bear Lake hikes',
        'Timed entry permits',
      ]),
      S('Rent a car', ['money']),
      S('Pack the hiking gear'),
      S('Find a pet sitter', ['calls']),
      S('Download offline maps', ['quick']),
      S(
        'Make the packing list',
        [],
        '- [ ] Layers\n- [ ] Rain jacket\n- [ ] Sunscreen\n- [ ] Snacks',
      ),
      S('Book a dinner in Boulder', ['calls']),
      S('Check the weather forecast', ['quick']),
      S('Get the national park pass', ['money']),
      S('Hold the mail', ['errands']),
      S('Share the itinerary with family', ['quick']),
      S('Plan a rainy-day backup'),
    ],
    move: [
      'Book the movers',
      'Forward the mail',
      'Cancel the old internet',
      'Pack the kitchen',
      'Clean the old apartment',
      'Return the keys',
      'Get the deposit back',
      'Update the address on accounts',
      'Transfer the utilities',
      'Label the boxes',
    ].map((title) => S(title)),
    garden: [
      S('Plant garlic for next year', ['home/yard']),
      S('Turn the compost', ['home/yard']),
      S('Order seed catalog', ['someday']),
      S('Harvest the last tomatoes', ['home/yard']),
      S('Mulch the perennial beds', ['home/yard']),
      S('Build a second raised bed', ['home/yard'], undefined, [
        'Buy cedar boards',
        'Cut and assemble',
        'Fill with soil',
      ]),
      S('Fix the drip irrigation', ['home/repairs']),
      S('Plant tulip bulbs', ['home/yard']),
      S('Prune the apple tree', ['home/yard']),
      S('Test the soil pH', ['research']),
      S('Cover the herbs for frost', ['home/yard', 'quick']),
      S('Plan the spring layout', ['someday']),
    ],
    bookclub: [
      S("Pick next month's book"),
      S('Host the December meeting'),
      S('Send the reading schedule'),
      S('Make the discussion questions'),
      S('Order copies of the book'),
      S('Plan the holiday book swap'),
      S("Vote on next year's themes"),
      S('Book the library room'),
    ],
    game: [
      S('Pick the board game for Friday'),
      S('Buy snacks for game night', ['errands']),
      S('Teach the new co-op game', [], 'Read the rules twice first.'),
      S('Print the score sheets', ['quick']),
      S('Plan the tournament bracket', [], undefined, ['Invite list', 'Pick the games', 'Prizes']),
      S('Return the borrowed expansion', ['errands']),
      S('Set up the video call for remote players'),
    ],
  };

  const membersOf = (key: string): Who[] => {
    const spec = list[key]!.spec;
    return [
      spec.owner,
      ...(spec.shareWith ?? []).filter(([, role]) => role === 'editor').map(([who]) => who),
    ];
  };

  const all: { id: string; key: string; author: Who; top: boolean; chore?: boolean }[] = [];
  function schedule(kind: 'past' | 'soon' | 'later' | 'none') {
    if (kind === 'none') return { schedule: null, due: null };
    const offset =
      kind === 'past' ? -between(1, 21) : kind === 'soon' ? between(0, 10) : between(11, 60);
    const date = addDays(TODAY, offset);
    const timed = chance(0.35);
    const hour = String(pick([7, 8, 9, 10, 13, 14, 15, 16, 18, 19])).padStart(2, '0');
    const start = timed ? `${date}T${hour}:${pick(['00', '15', '30', '45'])}` : date;
    const multiDay = !timed && chance(0.08);
    const sched = {
      start,
      end: multiDay ? addDays(date, between(1, 4)) : null,
      allDay: !timed,
      timeZone: ZONE,
    };
    const due = chance(0.3)
      ? { at: addDays(date, between(0, 7)), allDay: true, timeZone: ZONE }
      : null;
    return { schedule: sched, due };
  }

  for (const [key, items] of Object.entries(plans)) {
    const listId = list[key]!.id;
    const owner = list[key]!.spec.owner;
    const crew = membersOf(key);
    for (const item of items) {
      const author: Who = chance(0.7) ? owner : pick(crew);
      const created = daysAgo(between(1, 110));
      at(created);
      const c = ctxOf(author);
      const plain = key === 'move' || key === 'groceries' || key === 'reading';
      const { schedule: sched, due } = schedule(
        plain ? 'none' : pick(['past', 'soon', 'soon', 'later', 'none', 'none'] as const),
      );
      const assignees = crew.length > 1 && chance(0.55) ? [`user:${people[pick(crew)].id}`] : [];
      const made = createTask(c, ws, {
        title: item.title,
        listId,
        notes:
          item.notes ??
          (chance(0.12)
            ? pick([
                'Ask Alex first.',
                'See the email from last week.',
                'Low priority unless it gets worse.',
                '**Important:** do this before the weekend.',
              ])
            : ''),
        priority: pick([0, 0, 0, 1, 1, 2, 3] as const),
        schedule: sched as never,
        due: due as never,
        tags: (item.tags ?? []).map((name) => tag[name]!).filter(Boolean),
        assignees,
      });
      ws = made.workspace;
      all.push({ id: made.task.id, key, author, top: true });
      for (const child of item.sub ?? []) {
        const title = typeof child === 'string' ? child : child.title;
        at(created + between(1, 60) * 60_000);
        const sub = createTask(c, ws, { title, listId, parentId: made.task.id });
        ws = sub.workspace;
        all.push({ id: sub.task.id, key, author, top: false });
        if (typeof child !== 'string') {
          for (const grand of child.sub) {
            const g = createTask(c, ws, { title: grand, listId, parentId: sub.task.id });
            ws = g.workspace;
            all.push({ id: g.task.id, key, author, top: false });
          }
        }
      }
    }
  }

  // Repeating chores (PL-060), each starting this week.
  for (const [title, key, tagName, rule, offset] of [
    ['Take out the recycling', 'household', 'home/cleaning', 'FREQ=WEEKLY', 1],
    ['Weekly review', 'inbox-sam', 'deep-work', 'FREQ=WEEKLY', 2],
    ['Water the plants', 'household', 'home/yard', 'FREQ=DAILY;INTERVAL=3', 0],
    ['Pay rent', 'inbox-sam', 'money', 'FREQ=MONTHLY', 5],
  ] as const) {
    at(daysAgo(between(30, 60)));
    const made = createTask(ctx, ws, {
      title,
      listId: list[key]!.id,
      schedule: { start: addDays(TODAY, offset), end: null, allDay: true, timeZone: ZONE },
      tags: [tag[tagName]!],
      recurrence: rule,
    });
    ws = made.workspace;
    all.push({ id: made.task.id, key, author: 'sam', top: true, chore: true });
  }

  // --- states: done, won't do, progress, pinned, trash ---------------------------------------------
  for (const entry of all) {
    if (entry.chore) continue;
    const task = requireEntity(ws, 'tasks', entry.id);
    const start = task.schedule?.start?.slice(0, 10);
    const past = start ? start < TODAY : false;
    const p =
      entry.key === 'move'
        ? 0.92
        : entry.key === 'groceries'
          ? 0.5
          : past
            ? 0.8
            : start
              ? 0.08
              : 0.22;
    if (chance(p)) {
      const created = Date.parse(task.createdAt);
      at(Math.max(Math.min(NOW - 3_600_000, created + between(1, 30) * DAY), created + 3_600_000));
      ws = setTaskStatus(
        ctxOf(pick(membersOf(entry.key))),
        ws,
        entry.id,
        chance(0.12) ? 'wontdo' : 'done',
      );
    }
  }
  for (const entry of all.filter((e) => e.top && (e.key === 'work' || e.key === 'household'))) {
    if (requireEntity(ws, 'tasks', entry.id).status === 'open' && chance(0.15)) {
      at(NOW - between(1, 10) * DAY);
      ws = setTaskProgress(
        ctxOf(list[entry.key]!.spec.owner),
        ws,
        entry.id,
        pick([20, 30, 50, 60, 80]),
      );
    }
  }
  for (const title of [
    'Prepare the Q4 planning deck',
    'Plan the holiday menu',
    'Book flights to Denver',
  ]) {
    const task = ws.entities.tasks.find((t) => t.title === title && t.status === 'open');
    if (task) {
      at(NOW - between(1, 5) * DAY);
      ws = setPinned(ctx, ws, task.id, true);
    }
  }
  // A few deleted tasks, so Trash has something.
  let trashed = 0;
  for (const entry of all.filter((e) => e.top && e.author === 'sam' && e.key === 'inbox-sam')) {
    if (trashed >= 4 || !chance(0.15)) continue;
    at(NOW - between(1, 20) * DAY);
    ws = deleteTask(ctx, ws, entry.id);
    trashed++;
  }

  // --- comments on shared lists --------------------------------------------------------------------
  const lines = [
    'On it this weekend.',
    "Can you grab the parts when you're out?",
    'Done the first half, rest tomorrow.',
    'I think we should wait until after the holidays.',
    'Found a cheaper option, link in the notes.',
    'Does Saturday work for everyone?',
    'Blocked until the delivery shows up.',
    'Nice, thanks!',
    'I moved this to next week.',
    'Ordered. Arrives Tuesday.',
    '**Heads up:** the store closes early Sunday.',
  ];
  for (const entry of all.filter((e) => e.top && !e.key.startsWith('inbox') && e.key !== 'move')) {
    const crew = membersOf(entry.key);
    if (crew.length < 2 || !chance(0.28)) continue;
    const task = requireEntity(ws, 'tasks', entry.id);
    if (task.deletedAt) continue;
    let when = Date.parse(task.createdAt);
    for (let i = 0; i < between(1, 3); i++) {
      when = Math.min(NOW - 600_000, when + between(2, 72) * 3_600_000);
      at(when);
      const author = pick(crew);
      const others = crew.filter((w) => w !== author);
      const body =
        others.length > 0 && chance(0.25)
          ? `@${people[pick(others)].username} ${pick(lines)}`
          : pick(lines);
      ws = addComment(ctxOf(author), ws, entry.id, body).workspace;
    }
  }

  // --- saved filters, and the finished move archived ------------------------------------------------
  at(NOW - 30 * DAY);
  ws = createSavedFilter(ctx, ws, 'Quick wins', { tags: [tag['quick']!] }).workspace;
  ws = createSavedFilter(ctx, ws, 'High priority', { priorities: [2, 3] }).workspace;
  at(NOW - 40 * DAY);
  ws = putEntity(
    ws,
    'lists',
    updateEntity(ctx, requireEntity(ws, 'lists', list['move']!.id), { archived: true }),
  );

  // --- one whole-server backup -----------------------------------------------------------------------
  type Row = { id: string; createdBy: string };
  const entities: { collection: string; ownerId: string; seq: number; entity: unknown }[] = [];
  for (const [collection, rows] of Object.entries(ws.entities) as [string, Row[]][]) {
    for (const row of rows) {
      const ownerId = collection === 'users' ? row.id : row.createdBy;
      entities.push({ collection, ownerId, seq: entities.length + 1, entity: row });
    }
  }
  const file = {
    format: 'pecklist-server-backup' as const,
    formatVersion: 1,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    app: { name: 'pecklist', version: 'demo-seed' },
    exportedAt: new Date(NOW).toISOString(),
    cursor: entities.length,
    accounts: (Object.keys(people) as Who[]).map((who) => ({
      id: people[who].id,
      username: people[who].username,
      passwordHash: null,
      role: 'user' as const,
      mustChangePassword: false,
      failedLogins: 0,
      lockedUntil: null,
      securityStamp: ulid(NOW - 125 * DAY),
      disabled: false,
      createdAt: new Date(NOW - 125 * DAY).toISOString(),
      friendCode: null,
    })),
    entities,
    // The server works out who sees what when it starts (SharingStartup).
    visibility: [],
    secrets: [],
  };
  return { file, workspace: ws };
}
