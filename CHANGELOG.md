# Changelog

## Phase 11 - Seasonal theme switcher (v15)
- `game.js`: new exported `THEMES` dictionary below `GAME_CONFIG` with `default` (the previous navy / periwinkle / rainbow-brick palette, unchanged) and `spooky` (bg `#1a0b2e`, paddle `#39ff14`, ball `#f8f8ff`, bricks pumpkin `#ff7518` / blood `#8a0303` / purple `#4b0082`, orange lives and HUD labels).
- `createGame()` resolves `activeTheme = THEMES[opts.theme || GAME_CONFIG.theme] || THEMES.default`; the single inline `draw()` (there are no separate drawPaddle / drawBall / drawBricks / drawLives functions) now reads background, playfield, bricks, paddle, ball, HUD bar / divider and lives from it, as do the brick-break particles. Silver / gold bricks, laser / catch paddle tints and capsule colours stay fixed because they carry gameplay meaning.
- `mount()` applies the theme's `--arcade-*` variables to the stage, so the DOM HUD (Phase 12) renders orange labels with an orange glow over the dark background; page and manifest background / theme colour are `#1a0b2e`.
- `GAME_CONFIG.theme` is now `"spooky"`. Cache `RR10021947-v15`, `version.js` `v15`.
- Tests: new `test/theme.test.mjs` (12 checks: palettes drawn through the real `draw()`, default look unchanged, fallback for unknown names, gold unthemed). Two existing assertions updated: particle colour follows the active theme; manifest "dark colour" check uses luminance instead of a `#0...` prefix.

## Naming cleanup
- Arktrix is the only user-facing / documented name. Removed the earlier project names from docs, `package.json`, comments and tests (test URLs now use `/arktrix/`). `RR10021947` remains as the internal project ID (storage keys, cache prefix, test suite). Corrected README: leaderboard key is `RR10021947.leaderboard`, test file is `test/RR10021947.test.mjs`. No behaviour change, so no version bump.

## Phase 12 - Opt-in DOM HUD (v14)
- `lib/anchor-ui.js`: new optional export `initAnchorHUD({ stage, W, H, hudH, padLeft, padRight })` returning `updateHUD({ level, score, high })`. `createControls` is unchanged.
  - Renders LEVEL / SCORE / HI as a click-through, `nowrap` flex strip inside the 40px `HUD_H` band (`#anchor-hud`); font is `max(12px, 3.5cqw)` (falls back to `vmin`) so it scales with the stage.
  - Dirty-checked: the DOM is touched only when level, score or high changed. No-op without a DOM (headless tests). Values are coerced to numbers, so no markup can be injected.
- `game.js`: Score / High Score / Level text removed from the canvas. The black bar, divider and lives (mini paddles) are still drawn on canvas. `mount()` calls `updateHUD(game.hud())` each frame; `game.hud()` reuses one object (no per-frame allocation) and passes the existing `high`.
- Title / version / build intentionally not shown in the gameplay bar (does not fit cleanly at 360px). Version strings still come only from `version.js`.
- `sw.js` cache `RR10021947-v14` and `version.js` `v14`. `test/pwa.test.mjs` now compares `sw.js` against `version.js` instead of hardcoding a number.
- Tests: new `test/hud.test.mjs` (11 checks: headless no-op, layout props, dirty-check, coercion). Whole suite green.

## Phase 6.1
- Extra-life pill `P` (+1 life): drops only from level 11 on (after level 10), 6% of drops; lives cap at 5 (bonus 1000 at the cap). `sw.js` cache `arktrix-v7`.

## Phase 6
- Procedural 100-level campaign (`levels.js`), replacing the three hand-written levels; `validateLevel` + tests over all 100.
- Top-10 leaderboard with 3-character names (`leaderboard.js`), new `NAME_ENTRY` loop state, on-canvas initials wheel on the steering rail (+ keyboard on desktop), leaderboard on the game-over screen, round counter in the HUD.
- `AnchorLoop`: `NAME_ENTRY` state (`GAMEOVER -> NAME_ENTRY -> GAMEOVER`); headless runner treats it as an ended run.
- `sw.js`: cache `arktrix-v6`, precaches `levels.js` and `leaderboard.js` (new test checks every module `game.js` imports is precached).
- `tools/gauntlet.mjs` bot gauntlet.

### Measured: 100-level gauntlet (40 seeded runs per bot, 3 lives for the whole campaign)
| Bot | Wins | Level reached (median / min / max) |
|---|---|---|
| tracker (aim noise 20, unlimited speed) | 40/40 (100%) | 100 / 100 / 100 |
| fast thumb (noise 26, 600 px/s) | 0/40 | 52 / 17 / 97 |
| average thumb (noise 30, 420 px/s) | 0/40 | 14 / 5 / 29 |
| slow thumb (noise 34, 300 px/s) | 0/40 | 2 / 1 / 4 |

The campaign is completable (every level is clearable: the tracker never times out and needs Mercy Aim ~2.7x per level). The bots with limited speed are crude models of a thumb (they chase the ball's current x, never its landing point), so treat their numbers as a relative difficulty curve, not a prediction. Perfect play takes ~6 hours of game time (about 3.6 min per level on average).

## Phase 5
- Replaced the split-screen scheme (top-80% action zone, absolute steering) with one-handed controls on the bottom rail.
- `AnchorInput`: `relative: true` delta steering (no teleport on touch; anchor re-bases at edges and on `setBounds`), tap detection (`tapMs` 200 / `tapPx` 10) firing `onAction`; presses outside the rail are ignored. Legacy absolute / whole-screen mode unchanged.
- Game: rail tap launches a caught ball / fires lasers; a tap that only starts / resumes / restarts the game is not also an in-game action.
- `sw.js` cache bumped `arktrix-v4` -> `arktrix-v5` so returning devices download the new controls.
- Tests: new relative-steering, tap-threshold and START-tap cases (106 game checks). Bots unchanged (they drive `feed()` / `act()`): 100/100 wins at 1200 s, same as Phase 4.

## Phase 4
- Mercy Aim (anti-stall v2): 12-15 s without brick damage -> next paddle/wall bounce nudged by a random +-3..5 deg.
- PWA: `manifest.json`, generated icons (180/192/512), cache-first `sw.js`, meta tags + SW registration in `index.html`.
- Tests: Mercy Aim cases in `arktrix.test.mjs`; new `pwa.test.mjs` (manifest, icons, precache list vs files on disk, SW behaviour in a sandbox).

### Measured (100 seeded runs, same tracker bot with aim noise, 3-level campaign)
| Cap | Wins | Timeouts |
|---|---|---|
| 400 s | 0 | 100 |
| 1200 s | 100 (100%) | 0 |
| 3000 s | 100 (100%) | 0 |

Campaign time for the bot: median 499 s, p90 575 s, max 629 s (about 150-180 s per level). Phase 3 was 87% at 3000 s, so the permanent stalls are gone; the 400 s cap is simply shorter than a full 3-level run for this bot.

## Phase 3
- `AnchorInput`: opt-in split-screen (`steerFrac`), `onAction` / `listen()` / `act()`, per-pointer steering ownership. Legacy behaviour unchanged.
- Arktrix: Laser fire and Catch release moved to the action zone; paddle moved up (y 488) so the rail strip does not cover it.
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
