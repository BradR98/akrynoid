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
- **Controls (split screen, two-handed):** the bottom 20% is the *steering rail* - slide there to move the Vaus 1:1 with `input.getX()`. The top 80% is the *action zone* - tap to launch / release a caught ball or fire lasers (`onAction`); it never moves the paddle. A finger that started on the rail keeps steering wherever it slides, so one thumb steers while the other taps. `AnchorInput({ steerFrac: 0.2 })` enables this (default 0 = whole screen steers); `input.listen('action', fn)` / `input.act()` for subscribers, bots and tests.
- **Paddle zones:** 5 equal zones, -60 / -35 / ~0 (+-8 deg spread) / +35 / +60 deg off vertical.
- **Bricks:** `#` Standard (1 HP, row colour), `S` Silver (3 HP, shade per hit), `G` Gold (indestructible), `.` empty. Collision is row/col index math (<= 4 cells per sub-step).
- **Speed:** +2% per destroyed brick (cap 1.8x), reset on life loss and each new level.
- **Capsules (10% from Standard/Silver):** E expand (+50%), C catch, L laser (C and L replace each other), D disruption (+2 balls).
- **States:** `LEVEL_CLEAR` was added to `AnchorLoop` (`PLAY -> LEVEL_CLEAR -> PLAY`); `GAMEOVER` at 0 lives or after the last level (win).
- Tests: `npm test` (lib + `test/akrynoid.test.mjs`).

### Phase 3 (input segregation, anti-stall, juice)
- **Anti-stall:** each ball watches its own direction; if `|vy|` stays under 0.3 (flat bounce) - or `|vx|` under 0.05 (pure vertical loop) - for 3 s, that component is nudged by 0.3 on the unit direction (the ball's speed is separate, so this is the equivalent of the +-1.5 px/s-scale `vy` nudge) and the direction is renormalised. Counted in `stats().stalls`.
- **Screen shake:** decaying canvas translation on life lost (9 px) and on Gold hits once ball speed >= 1.2x (3-7 px).
- **Particles:** pooled ring buffer (128 squares, own PRNG); a destroyed Standard / Silver brick bursts 5-10 fading, gravity-affected squares in the brick's colour.
- **Known limit:** the anti-stall does not catch *periodic orbits* (e.g. a ball locked in a 35-degree lane that never reaches the last brick); see CHANGELOG.
