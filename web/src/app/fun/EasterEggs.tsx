import { Box, GlobalStyles } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { changedEntities, getEntity } from '../../core/collections.ts';
import { inboxList } from '../../core/lists.ts';
import { openCounts, todayGroups } from '../../core/queries.ts';
import type { Comment, Task, WorkspaceFile } from '../../core/types.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useStoreState, useWorkspace } from '../store/hooks.ts';
import {
  burst,
  hatch,
  isPinataTitle,
  isQuack,
  isTypewriterTitle,
  konamiTracker,
  onHatch,
  seasonOf,
  type Egg,
} from './eggs.ts';
import { Particles, type ParticleShow } from './Particles.tsx';

/** How long the modes last. */
const RETRO_MS = 60_000;
const DISCO_MS = 30_000;
const TYPEWRITER_MS = 120_000;
const WINK_MS = 2_400;
/** A quick run of completions that brings Punchy out. */
const STREAK = 5;
const STREAK_MS = 120_000;

/** A body class while a mode is on (retro, disco, typewriter, wink). */
function useMode(name: string, ms: number): [boolean, () => void] {
  const [until, setUntil] = useState(0);
  const on = until > 0;
  useEffect(() => {
    if (!on) return;
    document.body.classList.add(`pl-egg-${name}`);
    const timer = setTimeout(() => setUntil(0), ms);
    return () => {
      clearTimeout(timer);
      document.body.classList.remove(`pl-egg-${name}`);
    };
  }, [on, name, ms, until]);
  return [on, () => setUntil(Date.now() + ms)];
}

/** A little square-wave blip, as an old console would make. */
function blip() {
  try {
    const AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof window.AudioContext }).webkitAudioContext;
    if (!AudioContext) return;
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const level = audio.createGain();
    tone.type = 'square';
    tone.frequency.setValueAtTime(660, audio.currentTime);
    tone.frequency.setValueAtTime(990, audio.currentTime + 0.07);
    level.gain.setValueAtTime(0.06, audio.currentTime);
    level.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
    tone.connect(level).connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + 0.2);
    tone.onended = () => void audio.close();
  } catch {
    // No sound is fine.
  }
}

type Critter = 'dog' | 'duck' | 'trophy' | 'mascot';

/** The little characters: a dog's walk, the rubber duck, the trophy and Punchy. */
function CritterShow({ critter, onDone }: { critter: Critter; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, critter === 'dog' ? 9000 : critter === 'duck' ? 7000 : 4200);
    return () => clearTimeout(timer);
  }, [critter, onDone]);
  const bubble = (text: string) => (
    <Box
      component="span"
      sx={{
        position: 'absolute',
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        mb: 0.5,
        px: 1.25,
        py: 0.5,
        borderRadius: 2,
        bgcolor: 'background.paper',
        color: 'text.primary',
        boxShadow: 4,
        fontSize: 13,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </Box>
  );
  const z = { zIndex: (theme: { zIndex: { tooltip: number } }) => theme.zIndex.tooltip + 1 };
  if (critter === 'dog') {
    return (
      <Box
        aria-hidden
        sx={{
          ...z,
          position: 'fixed',
          bottom: 'calc(64px + env(safe-area-inset-bottom))',
          left: 0,
          fontSize: 34,
          pointerEvents: 'none',
          animation: 'pl-dog-walk 5s linear forwards',
          '@keyframes pl-dog-walk': {
            from: { transform: 'translateX(-60px)' },
            to: { transform: 'translateX(calc(100vw - 120px))' },
          },
          '& .pl-dog-zz': {
            position: 'absolute',
            top: -18,
            right: -10,
            fontSize: 18,
            opacity: 0,
            animation: 'pl-dog-nap 4s 5s ease-in-out forwards',
          },
          '@keyframes pl-dog-nap': { '0%, 100%': { opacity: 0 }, '20%, 80%': { opacity: 1 } },
        }}
      >
        <Box
          component="span"
          sx={{
            display: 'inline-block',
            transform: 'scaleX(-1)',
            animation: 'pl-dog-trot 0.3s ease-in-out 16 alternate',
            '@keyframes pl-dog-trot': { to: { transform: 'scaleX(-1) translateY(-4px)' } },
          }}
        >
          🐕
        </Box>
        <span className="pl-dog-zz">💤</span>
      </Box>
    );
  }
  const center = critter === 'trophy';
  const content = {
    duck: { face: '🦆', words: t('fun.duckSays') },
    trophy: { face: '🏆', words: t('fun.trophySays') },
    mascot: { face: '🥊', words: t('fun.mascotSays') },
  }[critter];
  return (
    <Box
      aria-hidden
      sx={{
        ...z,
        position: 'fixed',
        pointerEvents: 'none',
        fontSize: center ? 96 : 52,
        ...(center
          ? { top: '40%', left: '50%', transform: 'translate(-50%, -50%)' }
          : critter === 'duck'
            ? { bottom: 'calc(80px + env(safe-area-inset-bottom))', left: 24 }
            : { bottom: 'calc(80px + env(safe-area-inset-bottom))', left: '50%', ml: '-26px' }),
        animation: center
          ? 'pl-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)'
          : 'pl-bounce 0.9s ease-in-out infinite alternate',
        '@keyframes pl-pop': { from: { transform: 'translate(-50%, -50%) scale(0.2)' } },
        '@keyframes pl-bounce': { to: { translate: '0 -10px' } },
      }}
    >
      <Box component="span" sx={{ position: 'relative', display: 'inline-block' }}>
        {bubble(content.words)}
        {content.face}
      </Box>
    </Box>
  );
}

/** The modes' looks, on the page while their body class is on. */
const modeStyles = (
  <GlobalStyles
    styles={{
      'body.pl-egg-retro, body.pl-egg-retro *': {
        fontFamily: '"Courier New", ui-monospace, monospace !important',
        letterSpacing: '0.02em',
      },
      'body.pl-egg-retro::after': {
        content: '""',
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 99999,
        background:
          'repeating-linear-gradient(to bottom, rgba(0,0,0,0.12) 0 1px, transparent 1px 3px)',
      },
      'body.pl-egg-disco #root': { animation: 'pl-disco 2.4s linear infinite' },
      '@keyframes pl-disco': {
        from: { filter: 'hue-rotate(0deg) saturate(1.4)' },
        to: { filter: 'hue-rotate(360deg) saturate(1.4)' },
      },
      'body.pl-egg-typewriter [data-row-title]': {
        animation: 'pl-type 0.9s steps(24, end)',
      },
      '@keyframes pl-type': {
        from: { clipPath: 'inset(0 100% 0 0)' },
        to: { clipPath: 'inset(0 0 0 0)' },
      },
      'body.pl-egg-wink [data-day]': {
        animation: 'pl-flip 0.9s cubic-bezier(0.45, 0, 0.2, 1)',
      },
      'body.pl-egg-wink [data-day]::after': { content: '"😉"', fontSize: '0.45em' },
      '@keyframes pl-flip': {
        from: { transform: 'rotate(0deg)' },
        to: { transform: 'rotate(-360deg)' },
      },
    }}
  />
);

/**
 * The hidden fun (R-FB-122): fifteen surprises behind their triggers (see eggs.ts EGGS). A line at
 * the top says what was found; with reduced motion asked for, only that line shows.
 */
export function EasterEggs() {
  const workspace = useWorkspace();
  const today = useToday();
  const me = useStoreState((state) => state.context().userId);
  const [show, setShow] = useState<ParticleShow | null>(null);
  // Surprises that come at once (the last task of the Mess Drawer was a piñata) take turns.
  const [critters, setCritters] = useState<{ id: number; critter: Critter }[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const critter = critters[0] ?? null;
  const nextCritter = useRef(0);
  const found = lines[0] ?? null;
  const [retro, startRetro] = useMode('retro', RETRO_MS);
  const [, startDisco] = useMode('disco', DISCO_MS);
  const [, startTypewriter] = useMode('typewriter', TYPEWRITER_MS);
  const [, startWink] = useMode('wink', WINK_MS);
  const retroOn = useRef(retro);
  useEffect(() => {
    retroOn.current = retro;
  });
  const titles = useRef<string[]>([]);
  const endShow = useCallback(() => setShow(null), []);
  const endCritter = useCallback(() => setCritters((queue) => queue.slice(1)), []);

  // What each surprise does: listened for once, so a page that hatches one as it changes (a
  // search) never finds nobody listening.
  const play = useRef<(egg: Egg) => void>(() => undefined);
  useEffect(() => {
    play.current = (egg: Egg) => {
      setLines((queue) => [...queue, t(`fun.${egg}`)]);
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      switch (egg) {
        case 'confetti':
          return setShow({ kind: 'confetti' });
        case 'pinata':
          return setShow({ kind: 'candy' });
        case 'fireworks':
          return setShow({ kind: 'fireworks' });
        case 'season':
          return setShow({ kind: 'season', pieces: seasonOf(new Date().getMonth() + 1).pieces });
        case 'matrix':
          return setShow({ kind: 'matrix', words: titles.current });
        case 'roll': {
          const root = document.getElementById('root') ?? document.body;
          root.animate?.([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
            duration: 1100,
            easing: 'cubic-bezier(0.45, 0, 0.2, 1)',
          });
          return;
        }
        case 'gravity': {
          const rows = [...document.querySelectorAll<HTMLElement>('[data-task-row]')].slice(0, 40);
          rows.forEach((row, index) =>
            row.animate?.(
              [
                { transform: 'translateY(0)' },
                { transform: 'translateY(110vh) rotate(8deg)', offset: 0.45 },
                { transform: 'translateY(110vh) rotate(8deg)', offset: 0.55 },
                { transform: 'translateY(-14px)', offset: 0.85 },
                { transform: 'translateY(0)' },
              ],
              { duration: 2400, delay: index * 35, easing: 'ease-in-out' },
            ),
          );
          return;
        }
        case 'retro':
          blip();
          return startRetro();
        case 'disco':
          return startDisco();
        case 'typewriter':
          return startTypewriter();
        case 'wink':
          return startWink();
        case 'dog':
        case 'duck':
        case 'trophy':
        case 'mascot':
          nextCritter.current += 1;
          return setCritters((queue) => [...queue, { id: nextCritter.current, critter: egg }]);
      }
    };
  });
  useEffect(() => onHatch((egg) => play.current(egg)), []);

  // The line saying what was found, for a moment (then the next one).
  useEffect(() => {
    if (!found) return;
    const timer = setTimeout(() => setLines((queue) => queue.slice(1)), 3000);
    return () => clearTimeout(timer);
  }, [found, lines.length]);

  // Keys, a shaken phone, and Today tapped quickly.
  useEffect(() => {
    const konami = konamiTracker();
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (konami(event.key)) hatch('confetti');
    };
    const onMotion = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity;
      if (!a) return;
      const force = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      if (force > 28 && burst('shake', 4, 1200)) hatch('gravity');
    };
    const onClick = (event: MouseEvent) => {
      const control = (event.target as HTMLElement | null)?.closest('button, a');
      if (control?.querySelector('[data-day]') && burst('today', 5, 2500)) hatch('wink');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('devicemotion', onMotion);
      window.removeEventListener('click', onClick, true);
    };
  }, []);

  // What I do to tasks and comments: completions, a typewriter title, a quack.
  const before = useRef<WorkspaceFile | null>(null);
  const lastInput = useRef(0);
  useEffect(() => {
    const touched = () => {
      lastInput.current = Date.now();
    };
    window.addEventListener('pointerdown', touched, true);
    window.addEventListener('keydown', touched, true);
    return () => {
      window.removeEventListener('pointerdown', touched, true);
      window.removeEventListener('keydown', touched, true);
    };
  }, []);
  const completions = useRef<number[]>([]);
  useEffect(() => {
    const previous = before.current;
    before.current = workspace;
    titles.current = workspace.entities.tasks
      .filter((task) => task.title && task.deletedAt === null)
      .slice(0, 200)
      .map((task) => task.title);
    if (!previous || previous === workspace) return;
    const changed = changedEntities(previous, workspace);
    let completed = false;
    // A change made here just now (a sync from elsewhere does not count).
    const mine = Date.now() - lastInput.current < 3000 && (changed.tasks ?? []).length > 0;
    for (const task of (changed.tasks ?? []) as Task[]) {
      const old = getEntity(previous, 'tasks', task.id);
      if (!old && task.createdBy === me && isTypewriterTitle(task.title)) hatch('typewriter');
      if (old?.status !== 'open' || task.status !== 'done' || task.completedBy !== me) continue;
      completed = true;
      if (isPinataTitle(task.title)) hatch('pinata');
      if (retroOn.current) blip();
      const now = Date.now();
      completions.current = [...completions.current.filter((at) => now - at < STREAK_MS), now];
      if (completions.current.length >= STREAK) {
        completions.current = [];
        hatch('mascot');
      }
    }
    for (const comment of (changed.comments ?? []) as Comment[]) {
      const old = getEntity(previous, 'comments', comment.id);
      if (!old && comment.createdBy === me && isQuack(comment.body)) hatch('duck');
    }
    if (completed) {
      const open = (ws: WorkspaceFile) => {
        const groups = todayGroups(ws, today);
        return groups.overdue.length + groups.today.length;
      };
      if (open(previous) > 0 && open(workspace) === 0) hatch('fireworks');
    }
    // Emptied by completing or moving its last task.
    if (mine) {
      const drawer = (ws: WorkspaceFile) => openCounts(ws).get(inboxList(ws).id) ?? 0;
      if (drawer(previous) > 0 && drawer(workspace) === 0) hatch('trophy');
    }
  }, [workspace, today, me]);

  return (
    <>
      {modeStyles}
      {show && <Particles show={show} onDone={endShow} />}
      {critter && <CritterShow key={critter.id} critter={critter.critter} onDone={endCritter} />}
      {found && (
        <Box
          role="status"
          sx={{
            position: 'fixed',
            top: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            px: 2,
            py: 0.75,
            borderRadius: 99,
            bgcolor: 'text.primary',
            color: 'background.paper',
            typography: 'body2',
            boxShadow: 6,
            zIndex: (theme) => theme.zIndex.tooltip + 2,
            pointerEvents: 'none',
          }}
        >
          {found}
        </Box>
      )}
    </>
  );
}
