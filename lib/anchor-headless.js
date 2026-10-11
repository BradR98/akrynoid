/**
 * anchor-headless.js - headless simulation + bot harness for any Anchor game (no DOM, no rAF, deterministic).
 *
 * A game plugs in through one factory:
 *
 *   createGame({ input, rng, loop }) => {
 *     update(dt)            // required: advance one step (same function the real loop calls)
 *     observe()             // required: return whatever a bot needs to see (plain object)
 *     outcome()             // optional: 'win' | 'lose' once the game has ended (default: game.won ? 'win' : 'lose')
 *     stats()               // optional: extra numbers to aggregate across runs, e.g. { minLives: 2 }
 *   }
 *
 * and a bot is just a function that reads the observation and drives the same Input a thumb would:
 *
 *   bot({ obs, input, t, frame, rng }) { input.feed(obs.ball.x, true); }
 *
 * The game calls `loop.gameOver()` itself when it ends (exactly as in the real build).
 *
 *   const r = runSim({ createGame, bot: bots.tracker({ target: o => o.ball.x }), maxSeconds: 90, seed: 7 });
 *   const b = runBatch({ createGame, bot }, 25);   // b.winRate, b.secs.avg, b.stats.minLives.min ...
 */
import { AnchorLoop, State } from './anchor-loop.js';
import { AnchorInput } from './anchor-input.js';

/** Small deterministic PRNG (same seed -> same run). Returns a function giving [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Run one game to completion (or the time cap) with a bot on the input.
 * @returns {{outcome:string, won:boolean, seconds:number, frames:number, state:string, seed:number, stats:object, game:object}}
 */
export function runSim({ createGame, bot, dt = 1 / 60, maxSeconds = 120, botEvery = 6, seed = 1, width = 360, height = 640, onFrame } = {}) {
  if (typeof createGame !== 'function') throw new TypeError('runSim needs createGame()');
  const rng = mulberry32(seed);
  const input = new AnchorInput({ width, height });                    // virtual: no container, no DOM
  let game = null;
  const loop = new AnchorLoop({ update: (d) => game.update(d), draw: () => {}, raf: null, caf: () => {}, now: () => 0, autoPause: false, maxDt: Infinity, fixedStep: 0 });
  game = createGame({ input, rng, loop });
  loop.start();
  const maxFrames = Math.ceil(maxSeconds / dt);
  let f = 0;
  while (loop.state === State.PLAY && f < maxFrames) {
    if (bot && f % botEvery === 0) bot({ obs: game.observe(), input, t: f * dt, frame: f, rng });
    input.update(dt);
    loop.step(dt);
    if (onFrame) onFrame(f, game);
    f++;
  }
  const ended = loop.state === State.GAMEOVER || loop.state === State.NAME_ENTRY;
  const outcome = ended ? (typeof game.outcome === 'function' ? game.outcome() : (game.won ? 'win' : 'lose')) : 'timeout';
  return { outcome, won: outcome === 'win', seconds: f * dt, frames: f, state: loop.state, seed, stats: typeof game.stats === 'function' ? game.stats() : {}, game };
}

const summarize = (a) => a.length ? { avg: a.reduce((s, v) => s + v, 0) / a.length, min: Math.min(...a), max: Math.max(...a) } : { avg: 0, min: 0, max: 0 };

/** Run `runs` seeded games and aggregate: winRate, seconds, and every numeric key the game returns from stats(). */
export function runBatch(opts, runs = 10) {
  const results = [], base = opts.seed ?? 1;
  for (let i = 0; i < runs; i++) results.push(runSim({ ...opts, seed: base + i }));
  const keys = new Set(); results.forEach((r) => Object.keys(r.stats).forEach((k) => typeof r.stats[k] === 'number' && keys.add(k)));
  const stats = {}; keys.forEach((k) => { stats[k] = summarize(results.map((r) => r.stats[k]).filter((v) => typeof v === 'number')); });
  const wins = results.filter((r) => r.won).length;
  return { runs, wins, losses: results.filter((r) => r.outcome === 'lose').length, timeouts: results.filter((r) => r.outcome === 'timeout').length,
           winRate: wins / runs, secs: summarize(results.map((r) => r.seconds)), stats, results };
}

/** Stock bots. A bot is `({obs, input, t, frame, rng}) => void`. */
export const bots = {
  /** Does nothing: useful as the "unplayed" baseline. */
  idle() { return () => {}; },
  /** Holds the trigger and parks the cannon at a fixed logical x. */
  hold(x) { return ({ input }) => input.feed(x, true); },
  /**
   * Steers toward target(obs) -> x, like a thumb: limited speed, optional aiming noise, optional reaction delay.
   * @param {{target:(obs:any)=>number, maxSpeed?:number, noise?:number, down?:boolean|((obs:any)=>boolean)}} o
   */
  tracker({ target, maxSpeed = Infinity, noise = 0, down = true, botDt = 0.1 } = {}) {
    return ({ obs, input, rng }) => {
      let want = target(obs); if (noise) want += (rng() * 2 - 1) * noise;
      const cur = input.getX(), step = maxSpeed * botDt, d = want - cur;
      input.feed(Math.abs(d) <= step ? want : cur + Math.sign(d) * step, typeof down === 'function' ? down(obs) : down);
    };
  },
};

/** Tiny assertion collector for headless test files. */
export function createTester(log = console.log) {
  let pass = 0, fail = 0;
  return {
    ok(cond, msg) { log((cond ? 'PASS ' : 'FAIL ') + msg); cond ? pass++ : fail++; },
    summary() { log(`\n${pass} PASS, ${fail} FAIL`); return fail ? 1 : 0; },
    get counts() { return { pass, fail }; },
  };
}
