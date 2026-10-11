import { AnchorLoop, State } from '../lib/anchor-loop.js';
import { AnchorInput } from '../lib/anchor-input.js';
import { runSim, bots, mulberry32, createTester } from '../lib/anchor-headless.js';
import * as G from '../game.js';

const t = createTester();
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const mk = (opts = {}, rngFn = mulberry32(5)) => {
  const input = new AnchorInput({ width: G.W, height: G.H });
  const loop = new AnchorLoop({ update: (d) => game.update(d), draw: () => {}, raf: null, caf: () => {}, now: () => 0, autoPause: false, maxDt: Infinity });
  const game = G.createGame({ input, rng: rngFn, loop }, { storage: null, ...opts });
  loop.start();
  return { input, loop, game, I: game.internals };
};
const tap = (input) => { input.feed(input.getX(), false); input.feed(input.getX(), true); };
const place = (b, x, y, dx, dy) => { b.active = true; b.stuck = false; b.x = x; b.y = y; b.dx = dx; b.dy = dy; };
const cellCenter = (r, c) => [(c + 0.5) * G.BW, G.GRID_TOP + (r + 0.5) * G.BH];

// ---- level parser
{
  const { I } = mk({ levels: [['#S G........', '............'.replace('.', '#')]] ? [['#SG.........', '#...........']] : [] });
  t.ok(I.bricks.kind[0] === G.KIND.STANDARD && I.bricks.kind[1] === G.KIND.SILVER && I.bricks.kind[2] === G.KIND.GOLD, 'parser: # S G map to Standard / Silver / Gold');
  t.ok(I.bricks.hp[0] === 1 && I.bricks.hp[1] === 3, 'parser: Standard 1 HP, Silver 3 HP');
  t.ok(I.bricks.remaining === 3 && I.bricks.rows === 2, 'parser: gold is not counted toward clearing');
  let threw = false; try { I.bricks.load(['###']); } catch (_) { threw = true; }
  t.ok(threw, 'parser: wrong-width row throws');
}

// ---- paddle bound to input + 5 zones
{
  const { input, game, I } = mk();
  input.feed(123, false); game.update(1 / 60);
  t.ok(near(I.paddle.x, 123), 'paddle x == input.getX() (1:1)');
  input.feed(0, false); game.update(1 / 60);
  t.ok(I.paddle.x >= I.paddle.w / 2 - 1e-6, 'paddle stays on-screen at the left edge');
  const a = [0.1, 0.3, 0.5, 0.7, 0.9].map(G.reflectAngle);
  t.ok(a[0] < a[1] && a[1] < a[2] && a[2] < a[3] && a[3] < a[4], '5 zones: angle increases monotonically left -> right');
  t.ok(Math.abs(a[2]) < 0.15 && Math.abs(a[0]) > 1 && Math.abs(a[1]) > 0.5 && Math.abs(a[1]) < Math.abs(a[0]), 'centre ~vertical; outer zones progressively sharper');
  t.ok(near(G.reflectAngle(0), G.reflectAngle(0.1)) && near(G.reflectAngle(1), G.reflectAngle(0.9)), 'edge zones are flat bands');
}

// ---- walls, bottom, paddle hit
{
  const { input, game, I } = mk(); const b = I.balls[0];
  input.feed(180, false);
  place(b, 3, 300, -1, 0.0001); b.dy = 0.5; game.update(1 / 60);
  t.ok(b.dx > 0, 'left wall reflects X');
  place(b, G.W - 3, 300, 1, 0.0001); b.dy = 0.5; game.update(1 / 60);
  t.ok(b.dx < 0, 'right wall reflects X');
  place(b, 100, G.HUD_H + 7, 0.3, -0.95); game.update(1 / 60);
  t.ok(b.dy > 0, 'top wall reflects Y');
  // paddle: hit right edge zone -> sharply right and upward; left -> left
  input.feed(180, false); game.update(1 / 60);
  place(b, 180 + I.paddle.w * 0.45, I.paddle.top - G.BALL_R + 1, 0, 1); game.update(1 / 600);
  t.ok(b.dy < 0 && b.dx > 0.8, 'paddle right edge -> sharp right angle');
  place(b, 180, I.paddle.top - G.BALL_R + 1, 0.4, 0.9); game.update(1 / 600);
  t.ok(b.dy < 0 && Math.abs(b.dx) < 0.2, 'paddle centre -> mostly vertical');
  t.ok(near(Math.hypot(b.dx, b.dy), 1), 'direction stays a unit vector (constant speed)');
}

// ---- lives / bottom wall / velocity reset / GAMEOVER
{
  const { input, game, loop, I } = mk(); input.feed(30, false);
  game.update(1 / 60);
  I.balls[0].stuck = false; I.balls[0].dx = 0; I.balls[0].dy = 1; I.balls[0].y = G.H + 20;     // falls past the paddle region
  I.balls[0].x = 330; game.speedMult; game.update(1 / 60);
  t.ok(game.observe().lives === 2 && game.observe().stuck, 'bottom wall: life lost, new ball served on the paddle');
  t.ok(game.speedMult === 1, 'bottom wall: velocity reset');
  for (let k = 0; k < 2; k++) { const b = I.balls.find((x) => x.active); b.stuck = false; b.x = 330; b.y = G.H + 20; b.dy = 1; b.dx = 0; game.update(1 / 60); }
  t.ok(loop.state === State.GAMEOVER && game.observe().lives === 0 && game.outcome() === 'lose', 'lives hit 0 -> GAMEOVER');
}

// ---- brick collision: side flips X, top flips Y, speed +2%, silver 3 HP, gold indestructible
{
  const lv = [['............', '.....#......', '.....S......', '.....G......']];
  const { game, I } = mk({ levels: lv }); const b = I.balls[0], B = I.bricks;
  const [cx, cy] = cellCenter(1, 5);
  place(b, 5 * G.BW - G.BALL_R + 1, cy, 1, 0.05); b.dx = 0.954; b.dy = 0.3;                       // hits the left face
  const dy0 = b.dy; game.update(1 / 120);
  t.ok(b.dx < 0 && b.dy === dy0, 'side impact flips X only');
  t.ok(B.kind[17] === G.KIND.EMPTY, 'standard brick destroyed in 1 hit');
  t.ok(near(game.speedMult, 1.02) && near(game.speed, G.BASE_SPEED * 1.02), 'ball speed +2% per brick destroyed');
  // top hit on silver (row 1 -> its top is the bottom of row 0 now empty)
  const [sx, sy] = cellCenter(2, 5);
  for (let hit = 1; hit <= 3; hit++) {
    place(b, sx, sy - G.BH / 2 - G.BALL_R + 1, 0.01, 1); b.dx = 0.01; b.dy = 1;
    const dx0 = b.dx; game.update(1 / 300);
    if (hit < 3) t.ok(b.dy < 0 && B.hp[29] === 3 - hit && B.kind[29] === G.KIND.SILVER && b.dx === dx0, `silver survives hit ${hit} (HP ${3 - hit}), top impact flips Y only`);
  }
  t.ok(B.kind[29] === G.KIND.EMPTY, 'silver destroyed on 3rd hit');
  const [gx, gy] = cellCenter(3, 5);
  for (let k = 0; k < 5; k++) { place(b, gx, gy - G.BH / 2 - G.BALL_R + 1, 0, 1); game.update(1 / 300); }
  t.ok(B.kind[3 * 12 + 5] === G.KIND.GOLD && b.dy < 0, 'gold is indestructible but reflects');
}

// ---- performance: collision only inspects the local cells (no full scan)
{
  const { game, I } = mk(); const b = I.balls[0];
  let reads = 0; const kind = I.bricks.kind;
  I.bricks.kind = new Proxy(kind, { get(tg, p, r) { if (typeof p === 'string' && /^\d+$/.test(p)) reads++; return Reflect.get(tg, p, r); } });
  place(b, 180, G.GRID_TOP + 30, 0.3, -0.95); reads = 0; game.update(1 / 60);
  t.ok(reads > 0 && reads < 40, `brick collision reads ${reads} cells per frame (local row/col lookup, not all ${G.COLS * G.MAX_ROWS})`);
  I.bricks.kind = kind;
}

// ---- capsules: 10% drop, fall straight down, effects
{
  let drops = 0;
  // statistical: drive damageBrick through the ball
  const { game, I } = mk({ levels: [Array(8).fill('############')] }, mulberry32(11)); const b = I.balls[0];
  let broke = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) {
    const [x, y] = cellCenter(r, c); place(b, x, y - G.BH / 2 - G.BALL_R + 1, 0, 1); game.update(1 / 300); broke++;
    if (!b.active) place(b, 0, 0, 0, 0);
  }
  drops = I.caps.filter((c) => c.active).length;
  t.ok(drops >= 3 && drops <= 20, `~10% of ${broke} bricks drop capsules (got ${drops})`);
}
{
  const { input, game, I } = mk({ levels: [['############', '############']] });
  const x0 = 100; input.feed(x0, false); game.update(1 / 60);
  const c = I.spawnCapsule(x0, 300, 'E'); const xs = c.x;
  game.update(0.1); t.ok(c.x === xs && c.y > 300, 'capsule falls strictly downward');
  c.y = I.paddle.top; game.update(1 / 60);
  t.ok(!c.active && game.flags.expanded, 'catching E sets Expand');
  for (let k = 0; k < 40; k++) game.update(1 / 60);
  t.ok(near(I.paddle.w, G.PADDLE_W * 1.5, 0.1), 'Expand: paddle width +50%');
  I.spawnCapsule(x0, I.paddle.top, 'C'); game.update(1 / 60);
  t.ok(game.flags.catchOn, 'catching C sets Catch');
  const b = I.balls.find((q) => q.active); b.stuck = false;
  place(b, x0 + 10, I.paddle.top - G.BALL_R + 1, 0.2, 1); game.update(1 / 600);
  t.ok(b.stuck, 'Catch: ball sticks to the paddle');
  input.feed(150, false); game.update(1 / 60);
  t.ok(near(b.x, 150 + 10, 0.5), 'stuck ball follows the paddle');
  game.update(1 / 60); tap(input); game.update(1 / 60);
  t.ok(!b.stuck && b.dy < 0, 'tap releases the caught ball');
  I.spawnCapsule(150, I.paddle.top, 'L'); game.update(1 / 60);
  t.ok(game.flags.laserOn && !game.flags.catchOn, 'catching L sets Laser (replaces Catch)');
  const before = I.bricks.remaining; input.feed(15 * 1, false); game.update(1 / 60);
  const colX = Math.floor((I.paddle.x - I.paddle.w / 2 + 6) / G.BW);
  tap(input); game.update(1 / 60);
  t.ok(I.lasers.some((l) => l.active), 'tap fires lasers');
  for (let k = 0; k < 60; k++) game.update(1 / 60);
  t.ok(I.bricks.remaining < before || I.bricks.kind[1 * 12 + colX] === G.KIND.EMPTY, 'laser deals 1 damage to a brick');
}
{
  const { game, I } = mk(); const b = I.balls[0]; place(b, 200, 400, 0, -1);
  I.spawnCapsule(I.paddle.x, I.paddle.top, 'D'); game.update(1 / 60);
  const n = I.balls.filter((q) => q.active).length;
  t.ok(n === 3, 'Disruption spawns 2 extra balls (3 total)');
  const act = I.balls.filter((q) => q.active);
  t.ok(act.every((q) => Math.abs(q.y - act[0].y) < 8) && act[0].dx !== act[1].dx, 'multiballs spawn at the ball position with spread');
}

// ---- state machine: LEVEL_CLEAR + win
{
  let cleared = 0;
  const { input, game, loop, I } = mk({ levels: [['#...........'], ['#...........']], onLevelClear: () => { cleared++; } });
  const b = I.balls[0]; const [x, y] = cellCenter(0, 0); place(b, x, y + G.BH / 2 + G.BALL_R - 1, 0, -1); game.update(1 / 300);
  t.ok(loop.state === State.LEVEL_CLEAR && cleared === 1, 'all Standard/Silver at 0 HP -> LEVEL_CLEAR');
  game.nextLevel(); loop.start();
  t.ok(loop.state === State.PLAY && game.observe().level === 2 && game.observe().bricksLeft === 1, 'next level loads and play resumes');
  const b2 = I.balls.find((q) => q.active); place(b2, x, y + G.BH / 2 + G.BALL_R - 1, 0, -1); game.update(1 / 300);
  t.ok(loop.state === State.GAMEOVER && game.won, 'last level cleared -> win via GAMEOVER');
}
{
  const lv = [['G#G.........']]; const { game, loop, I } = mk({ levels: lv });
  t.ok(I.bricks.remaining === 1, 'gold does not block level clear');
}

// ---- headless integration
{
  const mkGame = (d) => G.createGame(d, { storage: null });
  // a human-ish player: follows the ball with aiming error (so it hits off-centre zones), taps to launch
  const player = ({ obs, input, frame, rng }) => input.feed(obs.ball.x + (rng() - 0.5) * 40, frame % 12 === 0);
  const r = runSim({ createGame: mkGame, bot: player, maxSeconds: 900, seed: 3 });
  t.ok(r.stats.level >= 2 && r.stats.destroyed > 40, `bot clears level 1 and progresses (${r.outcome}, level ${r.stats.level}, destroyed ${r.stats.destroyed}, score ${r.stats.score})`);
  const avoider = ({ obs, input, frame }) => input.feed(obs.stuck ? 180 : (obs.ball.x > 180 ? 20 : 340), frame % 12 === 0);
  const lose = runSim({ createGame: mkGame, bot: avoider, maxSeconds: 300, seed: 3 });
  t.ok(lose.outcome === 'lose' && lose.state === State.GAMEOVER && lose.stats.lives === 0, 'a paddle that dodges the ball loses all 3 lives -> GAMEOVER');
}

process.exit(t.summary());
