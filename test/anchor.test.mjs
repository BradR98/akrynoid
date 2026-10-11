import { AnchorLoop, State } from '../lib/anchor-loop.js';
import { AnchorInput } from '../lib/anchor-input.js';
import { runSim, runBatch, bots, mulberry32, createTester } from '../lib/anchor-headless.js';
import { createCatcher } from '../examples/catcher-game.js';

const T = createTester();
const { ok } = T;
const throws = (f) => { try { f(); return false; } catch (_) { return true; } };

// ---------- anchor-loop ----------
{
  const calls = { u: 0, d: 0, dts: [] }, seen = [];
  const loop = new AnchorLoop({ update: (dt) => { calls.u++; calls.dts.push(dt); }, draw: () => calls.d++, onState: (n, p) => seen.push(p + '>' + n), raf: null, autoPause: false, maxDt: 0.05 });
  ok(loop.state === State.START, 'loop begins in START');
  loop.step(0.016); ok(calls.u === 0 && calls.d === 1, 'START: draws, never updates');
  ok(throws(() => loop.setState(State.PAUSE)) && throws(() => loop.setState(State.GAMEOVER)), 'START cannot jump to PAUSE / GAMEOVER');
  loop.start(); loop.step(0.016); ok(loop.state === State.PLAY && calls.u === 1, 'PLAY: update runs');
  loop.step(1); ok(Math.abs(calls.dts[1] - 0.05) < 1e-9, 'delta time is clamped to maxDt (1s -> 0.05s)');
  loop.pause(); const u0 = calls.u; loop.step(0.016); ok(loop.state === State.PAUSE && calls.u === u0, 'PAUSE: update frozen');
  loop.resume(); ok(loop.state === State.PLAY, 'resume returns to PLAY');
  loop.gameOver(); loop.step(0.016); ok(loop.state === State.GAMEOVER, 'GAMEOVER reached from PLAY');
  const uG = calls.u; loop.step(0.016); ok(calls.u === uG, 'GAMEOVER: update frozen');
  ok(throws(() => loop.setState(State.PAUSE)), 'GAMEOVER cannot pause');
  loop.reset(); ok(loop.state === State.START, 'GAMEOVER -> START via reset()');
  ok(seen.join(',') === 'START>PLAY,PLAY>PAUSE,PAUSE>PLAY,PLAY>GAMEOVER,GAMEOVER>START', 'onState reports every transition: ' + seen.join(','));
  ok(throws(() => new AnchorLoop({ update() {} })), 'update() and draw() callbacks are mandatory');
}
{ // fixed timestep
  let n = 0; const dts = new Set(), alphas = [];
  const loop = new AnchorLoop({ update: (dt) => { n++; dts.add(dt); }, draw: (a) => alphas.push(a), raf: null, autoPause: false, fixedStep: 1 / 100 });
  loop.start(); loop.step(0.05); ok(n === 5 && dts.size === 1 && [...dts][0] === 0.01, 'fixedStep: a 50ms frame = 5 updates of exactly 10ms');
  loop.step(0.015); ok(n === 6 && alphas[alphas.length - 1] > 0.4 && alphas[alphas.length - 1] < 0.6, 'fixedStep: leftover time becomes the draw() interpolation alpha');
}
{ // injected requestAnimationFrame + visibility auto-pause
  let t = 0, pending = null, cancelled = 0, frames = 0;
  const raf = (f) => { pending = f; return 1; }, caf = () => { cancelled++; pending = null; };
  const vis = { hidden: false, listeners: {}, addEventListener(e, f) { this.listeners[e] = f; } };
  const loop = new AnchorLoop({ update: () => frames++, draw: () => {}, raf, caf, now: () => t, visibility: vis });
  loop.start(); ok(typeof pending === 'function', 'start() schedules requestAnimationFrame');
  t = 16; pending(16); ok(frames === 1, 'rAF callback advances one frame using the timestamp');
  vis.hidden = true; vis.listeners.visibilitychange(); ok(loop.state === State.PAUSE && pending === null && cancelled >= 1, 'hidden tab auto-pauses and cancels rAF (no battery use)');
  loop.resume(); ok(typeof pending === 'function', 'resume restarts rAF');
}

// ---------- anchor-input (fake DOM) ----------
{
  const mk = () => { const o = { style: {}, children: [], attrs: {}, listeners: {}, parentNode: null,
    appendChild(c) { c.parentNode = o; o.children.push(c); }, removeChild(c) { o.children = o.children.filter((x) => x !== c); },
    addEventListener(t, f) { o.listeners[t] = f; }, removeEventListener(t) { delete o.listeners[t]; }, setAttribute(k, v) { o.attrs[k] = v; },
    setPointerCapture() {}, getBoundingClientRect: () => ({ left: 50, top: 0, width: 180, height: 320 }) }; return o; };
  const doc = { createElement: mk }, container = mk(), ev = { downs: 0, ups: 0 };
  const input = new AnchorInput({ container, document: doc, width: 360, height: 640, on: { onDown: () => ev.downs++, onUp: () => ev.ups++ } });
  const pe = (x, type = 'touch') => ({ clientX: x, pointerId: 1, pointerType: type, preventDefault() {} });
  ok(container.children.length === 1 && input.el.attrs['data-anchor-input'] === 'overlay' && input.strip && input.strip.attrs['data-anchor-input'] === 'trackpad', 'builds a flat overlay with a trackpad strip inside the container');
  input.el.listeners.pointerdown(pe(140)); ok(input.isDown() && Math.abs(input.getX() - 180) < 1e-6, 'screen x 140 on a 180px-wide overlay at left 50 -> logical 180 (1:1 mapping, scaled)');
  input.el.listeners.pointermove(pe(50)); ok(input.getX() === 0, 'left edge -> 0 (clamped)');
  input.el.listeners.pointermove(pe(900)); ok(input.getX() === 360, 'far right clamps to the board width');
  input.setBounds(20, 340); ok(input.getX() === 340, 'setBounds re-clamps the current x');
  input.el.listeners.pointerup(pe(0)); ok(!input.isDown() && ev.downs === 1 && ev.ups === 1, 'pointerup releases; onDown / onUp fire once');
  input.el.listeners.pointermove(pe(95, 'mouse')); ok(Math.abs(input.getX() - 90) < 1e-6, 'a hovering mouse steers without a button (desktop)');
  input.feed(100, true); ok(input.getX() === 100 && input.isDown(), 'feed() drives input programmatically (bots / replays)');
  const sm = new AnchorInput({ width: 360, smoothing: 10 }); sm.feed(0); sm._target = 100; sm.update(0.05); ok(sm.getX() > 0 && sm.getX() < 100, 'optional smoothing eases toward the finger');
  input.destroy(); ok(container.children.length === 0, 'destroy() removes the overlay');
  const v = new AnchorInput({}); v.feed(500, true); ok(v.getX() === 360 && v.isDown(), 'virtual input (no DOM) works for headless');
}

// ---------- anchor-headless ----------
{
  const createGame = (ctx) => createCatcher(ctx);
  const track = bots.tracker({ target: (o) => o.ball.x, maxSpeed: 1500 });
  const a = runSim({ createGame, bot: track, seed: 5 }), b = runSim({ createGame, bot: track, seed: 5 });
  ok(a.won && a.outcome === 'win' && a.stats.caught === 15, 'a tracking bot wins the catcher game (' + a.seconds.toFixed(1) + 's, caught ' + a.stats.caught + ')');
  ok(a.seconds === b.seconds && a.stats.caught === b.stats.caught, 'same seed -> identical run (deterministic)');
  const idle = runSim({ createGame, bot: bots.idle(), seed: 5 });
  ok(idle.outcome === 'lose' && idle.stats.minLives === 0, 'an idle bot loses (baseline)');
  const slow = runBatch({ createGame, bot: bots.tracker({ target: (o) => o.ball.x, maxSpeed: 60 }) }, 10), fast = runBatch({ createGame, bot: track }, 10);
  ok(fast.winRate === 1 && slow.winRate < fast.winRate, 'runBatch compares bots for balancing (fast ' + (fast.winRate * 100) + '% vs slow-thumb ' + (slow.winRate * 100) + '%)');
  ok(fast.stats.caught.avg === 15 && fast.secs.avg > 0 && fast.runs === 10, 'batch aggregates seconds + numeric stats() across runs');
  const cap = runSim({ createGame: (c) => ({ update() {}, observe: () => ({}) }), maxSeconds: 2 });
  ok(cap.outcome === 'timeout' && Math.abs(cap.seconds - 2) < 0.02, 'a game that never ends times out at maxSeconds');
  const r = mulberry32(1), r2 = mulberry32(1); ok(r() === r2() && r() === r2() && mulberry32(2)() !== mulberry32(1)(), 'mulberry32 is seeded and deterministic');
}
process.exit(T.summary());
