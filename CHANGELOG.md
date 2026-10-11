# Changelog

## Phase 5
- Replaced the split-screen scheme (top-80% action zone, absolute steering) with one-handed controls on the bottom rail.
- `AnchorInput`: `relative: true` delta steering (no teleport on touch; anchor re-bases at edges and on `setBounds`), tap detection (`tapMs` 200 / `tapPx` 10) firing `onAction`; presses outside the rail are ignored. Legacy absolute / whole-screen mode unchanged.
- Game: rail tap launches a caught ball / fires lasers; a tap that only starts / resumes / restarts the game is not also an in-game action.
- `sw.js` cache bumped `akrynoid-v4` -> `akrynoid-v5` so returning devices download the new controls.
- Tests: new relative-steering, tap-threshold and START-tap cases (106 game checks). Bots unchanged (they drive `feed()` / `act()`): 100/100 wins at 1200 s, same as Phase 4.

## Phase 4
- Mercy Aim (anti-stall v2): 12-15 s without brick damage -> next paddle/wall bounce nudged by a random +-3..5 deg.
- PWA: `manifest.json`, generated icons (180/192/512), cache-first `sw.js`, meta tags + SW registration in `index.html`.
- Tests: Mercy Aim cases in `akrynoid.test.mjs`; new `pwa.test.mjs` (manifest, icons, precache list vs files on disk, SW behaviour in a sandbox).

### Measured (100 seeded runs, same tracker bot with aim noise, 3-level campaign)
| Cap | Wins | Timeouts |
|---|---|---|
| 400 s | 0 | 100 |
| 1200 s | 100 (100%) | 0 |
| 3000 s | 100 (100%) | 0 |

Campaign time for the bot: median 499 s, p90 575 s, max 629 s (about 150-180 s per level). Phase 3 was 87% at 3000 s, so the permanent stalls are gone; the 400 s cap is simply shorter than a full 3-level run for this bot.

## Phase 3
- `AnchorInput`: opt-in split-screen (`steerFrac`), `onAction` / `listen()` / `act()`, per-pointer steering ownership. Legacy behaviour unchanged.
- Akrynoid: Laser fire and Catch release moved to the action zone; paddle moved up (y 488) so the rail strip does not cover it.
- Ball anti-stall monitor (flat bounce and pure-vertical loop), `stats().stalls`.
- Screen shake, pooled particle bursts.
- Headless bot result: bot win rate at the 400 s cap is *not* improved (see below).

### Measured (30 seeded runs, tracker bot with aim noise)
| Cap | Phase 2 wins | Phase 3 wins | Phase 3 timeouts |
|---|---|---|---|
| 400 s | 8 (27%) | 1 (3%) | 29 |
| 1200 s | 21 (70%) | 25 (83%) | 5 |
| 3000 s | 21 (70%) | 26 (87%) | 4 |

The 400 s timeouts are mostly slow endgames, not stalls (the monitor fires ~0.7x per run). Permanent stalls fell from 9 to 4 per 30 runs. The 4 left are periodic +-35 degree orbits that miss the last brick. Idea: progress-based stall (no brick damage for N s -> re-aim).

## Phase 2
- Core engine: paddle zones, bricks, capsules (E/C/L/D), `LEVEL_CLEAR` state, tests.
