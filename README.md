# Arktrix / Arcade Anchor framework

Reusable, dependency-free ES6 modules in `lib/` that any mobile arcade game can call, plus **Arktrix** (an Arkanoid-style game, Phase 2 engine in `game.js`).

| Module | Role |
|---|---|
| `lib/anchor-loop.js` | `AnchorLoop`: rAF loop with clamped delta time (optional fixed step) and a strict state machine `START -> PLAY <-> PAUSE`, `PLAY -> GAMEOVER -> START`. Takes any `update(dt)` / `draw(alpha)`. Auto-pauses when the tab is hidden. |
| `lib/anchor-input.js` | `AnchorInput`: builds a flat trackpad overlay over your stage, handles touch + mouse, exposes `getX()` (logical, clamped), `isDown()`, `feed()` for bots. Immune to CSS tilt / scaling underneath. |
| `lib/anchor-headless.js` | `runSim` / `runBatch` / `bots` / `mulberry32` / `createTester`: run any game with no DOM, inject a bot onto the same input, get win rate / time / custom stats. Deterministic by seed. |

```js
import { AnchorLoop } from './lib/anchor-loop.js';
import { AnchorInput } from './lib/anchor-input.js';
const input = new AnchorInput({ container: stageEl, width: 360, height: 640 });
const loop = new AnchorLoop({ update: dt => { paddle.x = input.getX(); /* ... */ }, draw: () => {/* ... */} });
loop.boot(); // draw the START screen; loop.start() on first tap
```

Balancing: `runBatch({ createGame, bot: bots.tracker({ target: o => o.ball.x, maxSpeed: 400 }) }, 50)` -> `{ winRate, secs, stats }`. See `examples/catcher-game.js` for the game contract (`update`, `observe`, `outcome`, `stats`) and `demo/index.html` for browser wiring (serve over http, or open with `--allow-file-access-from-files`).

`npm test` runs `test/anchor.test.mjs` (37 checks, Node 18+, no install).

### Themes (Phase 11)
`THEMES` in `game.js` holds the palettes; set `GAME_CONFIG.theme` to `"default"` or `"spooky"` (unknown names fall back to `default`). A theme colours the canvas (background, bricks, paddle, ball, HUD bar, lives) and sets `--arcade-*` variables for the DOM HUD. Silver / gold bricks and capsules keep fixed colours because they carry gameplay meaning.

### Anchor HUD (opt-in, Phase 12)
`initAnchorHUD({ stage, W, H, hudH })` (in `lib/anchor-ui.js`) returns `updateHUD({ level, score, high })`, a DOM Level / Score / High strip inside the top `hudH` band. It only touches the DOM when a value changes and does nothing without a DOM. `createControls` is unaffected; games that do not call it are unchanged. Arktrix feeds it from `game.hud()` in `mount()`.

## Arktrix (Phase 2 engine)

`index.html` + `game.js` (serve over http: `python3 -m http.server`, open on a phone).

- **Wiring:** `mount()` builds an `AnchorInput` trackpad and an `AnchorLoop`; the loop's `update(dt)` / `draw()` call `game.update(dt)` / `game.draw(ctx)`. `createGame()` is DOM-free, so the same engine runs headless (`runSim`).
- **Controls (one hand, bottom rail):** only the bottom 20% of the screen listens; the top 80% ignores input. Steering is *relative*: touching the rail never moves the paddle, dragging moves it by exactly the finger's travel, and lifting then touching elsewhere starts a new drag from where the paddle already is. A quick, still touch (< 200 ms, < 10 px) is a **tap**: it launches a caught ball or fires lasers (`onAction`). `AnchorInput({ steerFrac: 0.2, relative: true })` enables this (defaults = whole-screen absolute steering); `input.listen('action', fn)` / `input.act()` for subscribers, bots and tests; `feed(x, down)` stays absolute for bots. On desktop, drag with the mouse on the rail (hover does not steer).
- **Paddle zones:** 5 equal zones, -60 / -35 / ~0 (+-8 deg spread) / +35 / +60 deg off vertical.
- **Bricks:** `#` Standard (1 HP, row colour), `S` Silver (3 HP, shade per hit), `G` Gold (indestructible), `.` empty. Collision is row/col index math (<= 4 cells per sub-step).
- **Speed:** +2% per destroyed brick (cap 1.8x), reset on life loss and each new level.
- **Capsules (10% from Standard/Silver):** E expand (+50%), C catch, L laser (C and L replace each other), D disruption (+2 balls), P extra life (pink; only drops after level 10, ~6% of drops, lives cap at 5 - at the cap it pays 1000 points).
- **States:** `LEVEL_CLEAR` was added to `AnchorLoop` (`PLAY -> LEVEL_CLEAR -> PLAY`); `GAMEOVER` at 0 lives or after the last level (win).
- Tests: `npm test` (lib + `test/RR10021947.test.mjs`).

### Phase 3 (input segregation, anti-stall, juice)
- **Anti-stall:** each ball watches its own direction; if `|vy|` stays under 0.3 (flat bounce) - or `|vx|` under 0.05 (pure vertical loop) - for 3 s, that component is nudged by 0.3 on the unit direction (the ball's speed is separate, so this is the equivalent of the +-1.5 px/s-scale `vy` nudge) and the direction is renormalised. Counted in `stats().stalls`.
- **Screen shake:** decaying canvas translation on life lost (9 px) and on Gold hits once ball speed >= 1.2x (3-7 px).
- **Particles:** pooled ring buffer (128 squares, own PRNG); a destroyed Standard / Silver brick bursts 5-10 fading, gravity-affected squares in the brick's colour.

### Phase 4 (Mercy Aim + PWA)
- **Mercy Aim:** a clock counts seconds since any brick took damage (hit or kill; Gold doesn't count; paused while the ball is held). After a random 12-15 s the next paddle or wall bounce rotates that ball by a random +-3..5 degrees, then the clock restarts. Breaks periodic orbits the Phase 3 monitor can't see. `stats().mercies` counts nudges.
- **PWA:** `manifest.json` (fullscreen, portrait, dark theme), `icons/` (generated by `node tools/make-icons.mjs`, no dependencies), `sw.js` (precaches the app + all of `lib/`, cache-first, works offline). Install via the browser's "Add to Home Screen". **Bump `CACHE` in `sw.js` on every deploy** or returning players keep the old build.

### Phase 6 (procedural campaign + leaderboard)
- **`levels.js`:** `generateLevel(i)` builds the 100-level campaign mathematically (pure, seeded, symmetric). Rows grow 4 -> 11; Standard-only until level 5, then Silver from ~6% to 60% of bricks; Gold from level 15 (1 mirrored pair, up to 5 pairs, never more than 10% of the bricks). Gold is only ever placed as isolated singles / mirrored pairs, so it can't wall the field (`validateLevel` enforces it; tests run it over all 100 levels). Level 1 is a solid wall, later levels carve seeded shapes (pyramid, diamond, stripes, columns, ...).
- **`leaderboard.js`:** Top-10 table of 3-character names in `localStorage` (`RR10021947.leaderboard`), sanitised on load. A score qualifies if it beats 10th place (or the table has a free row) and is > 0.
- **Flow:** `PLAY -> GAMEOVER -> NAME_ENTRY -> GAMEOVER`. At the end of a run (0 lives or level 100 cleared) a qualifying score enters `NAME_ENTRY`; saving returns to the game-over screen, which shows the Top 10 with your row blinking. Non-qualifying runs go straight to that screen.
- **Initials entry:** an on-canvas arcade wheel driven by the steering rail (no keyboard pop-up on phones): drag left/right to scroll A-Z + DEL + END (14 px per symbol), tap to pick; after the third letter the wheel jumps to END. Desktop: type letters/digits, Backspace, Enter. Input is ignored for the first 0.7 s (a finger still down from play), and a restart tap is ignored for 0.6 s so the board can't be skipped by accident.
- **Headless:** `node tools/gauntlet.mjs [runs] [maxSeconds]` runs seeded bots through all 100 levels. `createGame(..., { nameEntry: false })` skips the leaderboard for bots.
