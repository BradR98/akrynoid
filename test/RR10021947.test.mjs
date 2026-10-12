import { AnchorLoop, State } from '../lib/anchor-loop.js';
import { AnchorInput } from '../lib/anchor-input.js';
import { runSim, bots, mulberry32, createTester } from '../lib/anchor-headless.js';
import * as G from '../game.js';
import { createAudio } from '../lib/anchor-audio.js';
import { BUILD_VERSION } from '../version.js';

console.log('\n=======================================');
console.log('   RR10021947 TEST SUITE - BUILD ' + BUILD_VERSION);
console.log('=======================================\n');

const t = createTester();
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const mk = (opts = {}, rngFn = mulberry32(5)) => {
  const input = new AnchorInput({ width: G.W, height: G.H });
  const loop = new AnchorLoop({ update: (d) => game.update(d), draw: () => {}, raf: null, caf: () => {}, now: () => 0, autoPause: false, maxDt: Infinity });
  const game = G.createGame({ input, rng: rngFn, loop }, { storage: null, nameEntry: false, ...opts });
  loop.start();
  return { input, loop, game, I: game.internals };
};
const tap = (input) => input.act();            // a tap on the rail
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

// ---- Phase 5 input (fake DOM): bottom rail only, relative steering (no teleport), rail taps
{
  let clock = 0, actions = 0, downs = 0, ups = 0;
  const mkEl = () => { const o = { style: {}, children: [], attrs: {}, listeners: {}, parentNode: null,
    appendChild(c) { c.parentNode = o; o.children.push(c); }, removeChild() {}, addEventListener(t, f) { o.listeners[t] = f; },
    removeEventListener() {}, setAttribute() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 640 }) }; return o; };
  const doc = { createElement: mkEl };
  const input = new AnchorInput({ container: mkEl(), document: doc, width: 360, height: 640, steerFrac: 0.2, relative: true, now: () => clock,
    on: { onAction: () => actions++, onDown: () => downs++, onUp: () => ups++ } });
  const pe = (x, y, id = 1, type = 'touch') => ({ clientX: x, clientY: y, pointerId: id, pointerType: type, buttons: 1, preventDefault() {} });
  const L = input.el.listeners, Y = 600;                                    // y >= 512 is the rail
  t.ok(input.railTop === 512 && input.strip.style.height === '20%', 'rail = bottom 20% (y >= 512 of 640)');
  t.ok(input.getX() === 180, 'paddle starts centred');

  // top 80% listens to nothing
  L.pointerdown(pe(300, 100)); L.pointermove(pe(40, 100)); L.pointerup(pe(40, 100));
  t.ok(input.getX() === 180 && !input.isDown() && actions === 0 && downs === 0, 'touches in the top 80% are ignored: no steer, no action, no down');
  L.pointerdown(pe(300, 511)); L.pointerup(pe(300, 511));
  t.ok(actions === 0 && downs === 0, 'y just above the rail is still ignored');

  // relative: touching far from the paddle does not teleport it
  clock = 1000; L.pointerdown(pe(40, Y)); t.ok(input.getX() === 180 && input.isDown() && downs === 1, 'touch-start at x=40 leaves the paddle at 180 (no teleport)');
  L.pointermove(pe(70, Y)); t.ok(input.getX() === 210, 'dragging +30px moves the paddle +30 from its start');
  L.pointermove(pe(10, Y)); t.ok(input.getX() === 150, 'dragging back past the start moves it below 180 (delta from touch-start)');
  L.pointermove(pe(70, 100)); t.ok(input.getX() === 210, 'the steering finger keeps steering after sliding up out of the rail');
  clock = 2000; L.pointerup(pe(70, 100)); t.ok(!input.isDown() && ups === 1 && actions === 0, 'a long drag is not a tap');

  // lift and re-place elsewhere: new drag from the current paddle x
  L.pointerdown(pe(300, Y)); t.ok(input.getX() === 210, 're-touch at x=300: paddle stays at 210');
  L.pointermove(pe(290, Y)); t.ok(input.getX() === 200, 'new drag is relative to the new touch-start (-10 -> 200)');
  clock = 3000; L.pointerup(pe(290, Y));

  // edge clamp re-bases the anchor (no dead zone)
  input.setBounds(32, 328); clock = 4000; L.pointerdown(pe(100, Y));
  L.pointermove(pe(400, Y)); t.ok(input.getX() === 328, 'clamped at the right bound');
  L.pointermove(pe(380, Y)); t.ok(input.getX() === 308, 'reverses immediately after overshooting the bound (anchor re-based)');
  input.setBounds(60, 300); t.ok(input.getX() === 300, 'setBounds re-clamps an active drag');
  L.pointermove(pe(370, Y)); t.ok(near(input.getX(), 290), 'drag continues from the re-clamped x after a bounds change (no jump)');
  clock = 9000; L.pointerup(pe(370, Y)); input.setBounds(0, 360);

  // taps
  actions = 0; input.feed(180, false);
  clock = 10000; L.pointerdown(pe(100, Y)); clock = 10120; L.pointerup(pe(103, Y));
  t.ok(actions === 1, 'quick (120ms), short (3px) press = tap -> onAction');
  t.ok(Math.abs(input.getX() - 180) <= 3, 'a tap barely moves the paddle (only its <=3px jitter)');
  clock = 11000; L.pointerdown(pe(100, Y)); clock = 11250; L.pointerup(pe(100, Y)); t.ok(actions === 1, 'press held 250ms is not a tap');
  clock = 12000; L.pointerdown(pe(100, Y)); clock = 12100; L.pointermove(pe(100, Y)); L.pointermove(pe(112, Y)); L.pointerup(pe(100, Y)); t.ok(actions === 1, 'moved 12px (>10) is not a tap even if released where it started');
  clock = 13000; L.pointerdown(pe(100, Y)); clock = 13050; L.pointermove(pe(100, Y - 30)); L.pointerup(pe(100, Y - 30)); t.ok(actions === 1, 'vertical travel counts toward the 10px limit');
  clock = 14000; L.pointerdown(pe(100, Y)); clock = 14050; L.pointercancel(pe(100, Y)); t.ok(actions === 1, 'a cancelled pointer is never a tap');
  clock = 15000; L.pointerdown(pe(100, Y)); clock = 15190; L.pointerup(pe(106, Y)); t.ok(actions === 2, '190ms / 6px is still a tap');
  clock = 16000; L.pointerdown(pe(50, Y, 1)); L.pointerdown(pe(300, Y, 2)); clock = 16050; L.pointerup(pe(300, Y, 2)); t.ok(actions === 2 && input.isDown(), 'a second finger on the rail is ignored');
  L.pointerup(pe(50, Y, 1));
  const before = input.getX(); L.pointermove(pe(5, Y, 1, 'mouse')); t.ok(input.getX() === before, 'hovering (no press) never steers in relative mode');

  // programmatic path unchanged: feed() is absolute, act() fires onAction
  input.feed(77, true); t.ok(input.getX() === 77, 'feed() still positions absolutely (bots)'); input.feed(77, false);
  const a2 = []; const off = input.listen('action', () => a2.push(1)); input.act(); off(); input.act(); t.ok(a2.length === 1, 'listen()/act() work; unsubscribe works');

  // legacy default (no steerFrac / relative) is unchanged: whole screen, absolute
  const legacy = new AnchorInput({ container: mkEl(), document: doc, width: 360, height: 640 });
  legacy.el.listeners.pointerdown(pe(90, 10)); t.ok(legacy.getX() === 90 && legacy.isDown(), 'default mode keeps whole-screen absolute steering');
}
// ---- the START tap must not also launch the ball
{
  const mkEl = () => { const o = { style: {}, children: [], listeners: {}, appendChild() {}, removeChild() {}, addEventListener(t, f) { o.listeners[t] = f; }, removeEventListener() {}, setAttribute() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 640 }) }; return o; };
  let clock = 0, game, loop;
  const input = new AnchorInput({ container: mkEl(), document: { createElement: mkEl }, steerFrac: 0.2, relative: true, now: () => clock, on: { onDown: () => { if (loop.state === State.START) loop.start(); } } });
  loop = new AnchorLoop({ update: (d) => game.update(d), draw: () => {}, raf: null, caf: () => {}, now: () => 0, autoPause: false, maxDt: Infinity });
  game = G.createGame({ input, rng: mulberry32(1), loop }, { storage: null });
  const L = input.el.listeners, pe = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', buttons: 1, preventDefault() {} });
  L.pointerdown(pe(100, 600)); clock = 80; L.pointerup(pe(100, 600));
  t.ok(loop.state === State.PLAY && game.internals.balls[0].stuck, 'tap on START starts the game but keeps the ball on the paddle');
  clock = 1000; L.pointerdown(pe(100, 600)); clock = 1080; L.pointerup(pe(100, 600));
  t.ok(!game.internals.balls[0].stuck, 'the next rail tap (in PLAY) launches it');
}
// ---- action wiring: rail tap releases Catch / fires Laser; START tap is not an action
{
  const { input, game, loop, I } = mk({ levels: [['############', '############']] });
  const b = I.balls[0]; t.ok(b.stuck, 'ball waits on the paddle');
  input.act(); t.ok(!b.stuck && b.dy < 0, 'onAction launches the waiting ball');
  I.spawnCapsule(I.paddle.x, I.paddle.top, 'L'); game.update(1 / 60); input.act();
  t.ok(I.lasers.filter((l) => l.active).length === 2, 'onAction fires the laser pair');
  const x0 = I.paddle.x; input.act(); game.update(1 / 60); t.ok(I.paddle.x === x0, 'action does not move the paddle');
  loop.pause(); const before = I.lasers.filter((l) => l.active).length; input.act(); t.ok(I.lasers.filter((l) => l.active).length === before, 'actions are ignored outside PLAY');
}

// ---- anti-stall
{
  const { game, I } = mk({ levels: [['G...........']] }); const b = I.balls[0];
  place(b, 180, 300, 0.99, 0.141);           // flat bounce: |dy| < STALL_VY
  const dy0 = Math.abs(b.dy); let nudged = 0, tNudge = -1;
  for (let f = 0; f < 60 * 4; f++) {
    b.y = 300; b.x = 180;                    // pin it mid-air so only the monitor is under test
    if (b.watch(1 / 60)) { nudged++; if (tNudge < 0) tNudge = f / 60; }
  }
  t.ok(nudged >= 1 && tNudge >= G.STALL_TIME - 0.05 && tNudge <= G.STALL_TIME + 0.1, `flat bounce nudged after ~${G.STALL_TIME}s (at ${tNudge.toFixed(2)}s)`);
  t.ok(Math.abs(b.dy) > dy0 + 0.1 && near(Math.hypot(b.dx, b.dy), 1), 'nudge raises |vy| and keeps a unit direction');
  place(b, 180, 300, 0, -1); let v = 0; for (let f = 0; f < 60 * 4; f++) { b.y = 300; if (b.watch(1 / 60)) v++; }
  t.ok(v >= 1 && Math.abs(b.dx) > 0.2, 'a pure-vertical loop is broken too');
  place(b, 180, 300, 0.7, 0.714); let n = 0; for (let f = 0; f < 60 * 10; f++) if (b.watch(1 / 60)) n++;
  t.ok(n === 0, 'healthy angles are never touched');
  // in-engine: a ball bouncing flat between the walls under the HUD gets freed
  const g2 = mk({ levels: [['G...........']] }); const b2 = g2.I.balls[0]; place(b2, 100, G.HUD_H + 8, 0.99, -0.14); g2.game.update(1 / 60);
  for (let f = 0; f < 60 * 5; f++) g2.game.update(1 / 60);
  t.ok(g2.game.stats().stalls >= 1, 'engine counts anti-stall nudges (stats.stalls)');
}

// ---- VFX: particles + screen shake
{
  const { game, I } = mk({ levels: [['#S..........', '............']] });
  const b = I.balls[0]; const [x, y] = cellCenter(0, 0);
  place(b, x, y + G.BH / 2 + G.BALL_R - 1, 0, -1); game.update(1 / 300);
  const n = I.fx.active; t.ok(n >= 5 && n <= 10, `standard brick destroyed -> burst of 5-10 particles (${n})`);
  const col = I.fx.col[I.fx.life.findIndex((l) => l > 0)]; t.ok(col === '#e53935', 'particles match the brick colour (row 0 red)');
  const [sx, sy] = cellCenter(0, 1); let before = I.fx.active;
  for (let hit = 0; hit < 3; hit++) { place(b, sx, sy + G.BH / 2 + G.BALL_R - 1, 0, -1); game.update(1 / 300); if (hit < 2) t.ok(I.fx.active === before, `silver hit ${hit + 1}: no burst until destroyed`); }
  t.ok(I.fx.active - before >= 5 && I.fx.active - before <= 10, 'silver destroyed -> burst');
  I.fx.step(1); t.ok(I.fx.active === 0, 'particles fade out and free their slots');
  const ctxStub = new Proxy({}, { get: (_, p) => (p === 'globalAlpha' ? 1 : () => {}), set: () => true });
  game.draw(ctxStub); t.ok(true, 'draw() runs with particles + shake against a stub context');
}
{
  const { input, game, I } = mk({ levels: [['G...........']] }); const b = I.balls[0];
  t.ok(game.shake === 0, 'no shake at rest');
  const [gx, gy] = cellCenter(0, 0); place(b, gx, gy + G.BH / 2 + G.BALL_R - 1, 0, -1); game.update(1 / 300);
  t.ok(game.shake === 0, 'gold hit at base speed: no shake');
  // push speed up via real brick breaks
  const lvl = Array(8).fill('############'); const g3 = mk({ levels: [lvl.slice(0, 6).concat(['............', 'GGGGGGGGGGGG'])] }); const b3 = g3.I.balls[0];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 12; c++) { const [x, y] = cellCenter(r, c); place(b3, x, y + G.BH / 2 + G.BALL_R - 1, 0, -1); g3.game.update(1 / 300); }
  t.ok(g3.game.speedMult >= G.GOLD_SHAKE_MULT, `speed multiplier reached ${g3.game.speedMult.toFixed(2)}`);
  const [hx, hy] = cellCenter(7, 4); place(b3, hx, hy - G.BH / 2 - G.BALL_R + 1, 0, 1); g3.game.update(1 / 300);
  t.ok(g3.game.shake > 3, `gold hit at speed shakes the screen (${g3.game.shake.toFixed(1)}px)`);
  const ctxStub = new Proxy({}, { get: (_, p) => (p === 'globalAlpha' ? 1 : () => {}), set: () => true });
  g3.game.draw(ctxStub); g3.game.draw(ctxStub);
  // life lost
  const g4 = mk({ levels: [['G#..........']] }); const b4 = g4.I.balls[0]; place(b4, 330, G.H + 20, 0, 1); g4.game.update(1 / 60);
  t.ok(g4.game.shake >= 9 && g4.game.observe().lives === 2, 'losing a life shakes the screen');
}

// ---- Mercy Aim (anti-stall v2)
{
  const { input, game, I } = mk({ levels: [['G#..........']] }); const b = I.balls[0];
  for (let f = 0; f < 60 * 20; f++) game.update(1 / 60);                       // ball is still stuck on the paddle
  t.ok(game.mercy.idle === 0 && !game.mercy.armed, 'clock does not run while the ball is held on the paddle');
  t.ok(game.mercy.at >= G.MERCY_MIN && game.mercy.at <= G.MERCY_MAX, `trigger time is randomised in [${G.MERCY_MIN}, ${G.MERCY_MAX}] s (${game.mercy.at.toFixed(1)})`);
  input.act(); const trig = game.mercy.at;
  const pin = () => { b.x = 180; b.y = 300; b.dx = 0.5; b.dy = 0.8660254; };
  pin(); let tArm = -1; for (let f = 0; f < 60 * 20 && tArm < 0; f++) { pin(); game.update(1 / 60); if (game.mercy.armed) tArm = f / 60; }
  t.ok(tArm >= trig - 0.1 && tArm <= trig + 0.1 && tArm >= 12 && tArm <= 15.1, `armed after ${tArm.toFixed(1)}s without brick damage`);
  t.ok(near(b.dx, 0.5) && near(b.dy, 0.8660254), 'arming alone does not change the trajectory (waits for a bounce)');
  place(b, G.W - 4, 300, 0.5, 0.8660254); game.update(1 / 120);                  // wall bounce
  const ang = (v) => Math.atan2(v.dx, v.dy), d = Math.abs(Math.atan2(Math.sin(ang(b) - Math.atan2(-0.5, 0.8660254)), Math.cos(ang(b) - Math.atan2(-0.5, 0.8660254)))) * 180 / Math.PI;
  t.ok(d >= 2.9 && d <= 5.1, `next wall bounce nudged by ${d.toFixed(2)} deg (3-5)`);
  t.ok(!game.mercy.armed && game.mercy.idle < 0.1 && game.stats().mercies === 1 && near(Math.hypot(b.dx, b.dy), 1), 'one nudge, clock re-armed, direction still unit length');
  // paddle bounce also carries the nudge; brick damage resets the clock
  for (let f = 0; f < 60 * 16; f++) { pin(); game.update(1 / 60); }
  t.ok(game.mercy.armed, 're-arms after another quiet period');
  place(b, 100, I.paddle.top - G.BALL_R + 1, 0, 1); input.feed(100 + 0.5 * 0, false); game.update(1 / 600);
  t.ok(game.stats().mercies === 2, 'paddle bounce also delivers the nudge');
  const { game: g2, I: I2 } = mk({ levels: [['S...........', '......G.....']] }); const bb = I2.balls[0]; g2.update(1 / 60); g2.internals.balls[0].stuck = false;
  const pin2 = () => { bb.x = 180; bb.y = 300; bb.dx = 0.5; bb.dy = 0.866; };
  for (let f = 0; f < 60 * 11; f++) { pin2(); g2.update(1 / 60); }
  const [sx, sy] = cellCenter(0, 0); place(bb, sx, sy + G.BH / 2 + G.BALL_R - 1, 0, -1); g2.update(1 / 300);    // silver takes damage (not destroyed)
  t.ok(g2.mercy.idle < 0.1 && I2.bricks.hp[0] === 2, 'damaging (not just destroying) a brick resets the clock');
  for (let f = 0; f < 60 * 11; f++) { pin2(); g2.update(1 / 60); }
  const [gx, gy] = cellCenter(1, 6); place(bb, gx, gy + G.BH / 2 + G.BALL_R - 1, 0, -1); g2.update(1 / 300);
  t.ok(g2.mercy.idle > 10, 'hitting indestructible Gold does not reset the clock');
}

// ---- headless integration
{
  const mkGame = (d) => G.createGame(d, { storage: null, nameEntry: false });
  // a human-ish player: follows the ball with aiming error (so it hits off-centre zones), taps to launch
  const player = ({ obs, input, frame, rng }) => { input.feed(obs.ball.x + (rng() - 0.5) * 40, true); if (obs.stuck && frame % 12 === 0) input.act(); };
  const r = runSim({ createGame: mkGame, bot: player, maxSeconds: 900, seed: 3 });
  t.ok(r.stats.level >= 2 && r.stats.destroyed > 40, `bot clears level 1 and progresses (${r.outcome}, level ${r.stats.level}, destroyed ${r.stats.destroyed}, score ${r.stats.score})`);
  const avoider = ({ obs, input, frame }) => { input.feed(obs.stuck ? 180 : (obs.ball.x > 180 ? 20 : 340), true); if (obs.stuck && frame % 12 === 0) input.act(); };
  const lose = runSim({ createGame: mkGame, bot: avoider, maxSeconds: 300, seed: 3 });
  t.ok(lose.outcome === 'lose' && lose.state === State.GAMEOVER && lose.stats.lives === 0, 'a paddle that dodges the ball loses all 3 lives -> GAMEOVER');
}

// ---- audio + pause
{
  const audio = createAudio();
  t.ok(!audio.supported || typeof audio.supported === 'boolean', 'createAudio is safe headlessly');
  let threw = false;
  try {
    audio.setEnabled(true);
    audio.playEvent('brick');
    audio.play('bounce');
    audio.toggle();
    audio.suspend();
    audio.resume();
  } catch(e) { threw = true; }
  t.ok(!threw, 'audio methods do not throw in headless mode');

  const { input, game, loop, I } = mk();
  loop.start();
  t.ok(loop.state === State.PLAY, 'starts in PLAY');
  loop.pause();
  t.ok(loop.state === State.PAUSE, 'transitions to PAUSE');
  loop.resume();
  t.ok(loop.state === State.PLAY, 'resumes to PLAY');
  loop.togglePause();
  t.ok(loop.state === State.PAUSE, 'toggles to PAUSE');
}

// ---- save state / auto-resume lifecycle
{
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
  const st = mem();

  // 1. New game loads, no save file -> level 1, 3 lives, score 0
  const input1 = new AnchorInput({ width: G.W, height: G.H });
  const loop1 = new AnchorLoop({ update: () => {}, draw: () => {}, raf: null, autoPause: false });
  const g1 = G.createGame({ input: input1, loop: loop1 }, { storage: st, levels: [['############'], ['############']] });
  t.ok(g1.stats().level === 1 && g1.stats().lives === 3 && g1.stats().score === 0, 'new game starts with default stats');
  
  // advancing level saves the state
  g1.internals.applyCapsule('E'); // adds 100 score
  g1.nextLevel();
  const saved = JSON.parse(st.getItem('RR10021947-save'));
  t.ok(saved && saved.level === 1 && saved.score === 100 && saved.lives === 3, 'nextLevel auto-saves state');

  // 2. Restarting the app loads the saved state
  const input2 = new AnchorInput({ width: G.W, height: G.H });
  const loop2 = new AnchorLoop({ update: () => {}, draw: () => {}, raf: null, autoPause: false });
  const g2 = G.createGame({ input: input2, loop: loop2 }, { storage: st, levels: [['############'], ['############']], nameEntry: false });
  t.ok(g2.stats().level === 2 && g2.stats().score === 100 && g2.stats().lives === 3, 'initial load restores saved level, score, lives');

  // 3. Losing all lives clears the save
  loop2.start();
  for (let i = 0; i < 3; i++) {
    g2.internals.balls[0].active = true; g2.internals.balls[0].stuck = false; g2.internals.balls[0].y = G.H + 20; // drop the last ball
    g2.update(1 / 60);
  }
  t.ok(loop2.state === State.GAMEOVER, 'game over reached');
  t.ok(st.getItem('RR10021947-save') === null, 'GAMEOVER wipes the save file');

  // 4. Restarting after GAMEOVER starts fresh
  const input3 = new AnchorInput({ width: G.W, height: G.H });
  const loop3 = new AnchorLoop({ update: () => {}, draw: () => {}, raf: null, autoPause: false });
  const g3 = G.createGame({ input: input3, loop: loop3 }, { storage: st, levels: [['############'], ['############']] });
  t.ok(g3.stats().level === 1 && g3.stats().score === 0, 'game after GAMEOVER starts fresh');
}

process.exit(t.summary());
