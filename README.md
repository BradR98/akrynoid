# Akrynoid / Arcade Anchor framework

Reusable, dependency-free ES6 modules in `lib/` that any mobile arcade game can call, plus **Akrynoid** (an Arkanoid-style game, next phase).

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
