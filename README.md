# Akrynoid / Arcade Anchor framework

Reusable, dependency-free ES6 modules in `lib/` that any mobile arcade game can call, plus **Akrynoid** (an Arkanoid-style game, Phase 2 engine in `game.js`).

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

## Akrynoid (Phase 2 engine)

`index.html` + `game.js` (serve over http: `python3 -m http.server`, open on a phone).

- **Wiring:** `mount()` builds an `AnchorInput` trackpad and an `AnchorLoop`; the loop's `update(dt)` / `draw()` call `game.update(dt)` / `game.draw(ctx)`. `createGame()` is DOM-free, so the same engine runs headless (`runSim`).
- **Controls:** slide on the trackpad to move the Vaus (1:1 with `input.getX()`); a *new touch* (tap) launches / releases a caught ball and fires lasers.
- **Paddle zones:** 5 equal zones, -60 / -35 / ~0 (+-8 deg spread) / +35 / +60 deg off vertical.
- **Bricks:** `#` Standard (1 HP, row colour), `S` Silver (3 HP, shade per hit), `G` Gold (indestructible), `.` empty. Collision is row/col index math (<= 4 cells per sub-step).
- **Speed:** +2% per destroyed brick (cap 1.8x), reset on life loss and each new level.
- **Capsules (10% from Standard/Silver):** E expand (+50%), C catch, L laser (C and L replace each other), D disruption (+2 balls).
- **States:** `LEVEL_CLEAR` was added to `AnchorLoop` (`PLAY -> LEVEL_CLEAR -> PLAY`); `GAMEOVER` at 0 lives or after the last level (win).
- Tests: `npm test` (lib + `test/akrynoid.test.mjs`).
