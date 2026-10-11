// Headless 100-level gauntlet: node tools/gauntlet.mjs [runs=20] [maxSeconds=60000]
// Runs seeded bots through the procedural campaign and prints win rate / progress. No DOM, no rAF.
import { runBatch, runSim } from '../lib/anchor-headless.js';
import * as G from '../game.js';

const RUNS = +process.argv[2] || 20, CAP = +process.argv[3] || 60000;
const mk = (d) => G.createGame(d, { storage: null, nameEntry: false });

/** A bot = how a thumb behaves: follows the ball with aim error, limited drag speed, taps the rail to launch. */
const thumb = ({ noise, maxSpeed }) => ({ obs, input, frame, rng }) => {
  const want = obs.ball.x + (rng() - 0.5) * 2 * noise, cur = input.getX(), step = maxSpeed * 0.1, d = want - cur;
  input.feed(Math.abs(d) <= step ? want : cur + Math.sign(d) * step, true);
  if (obs.stuck && frame % 12 === 0) input.act();
};
const BOTS = {
  'tracker (noise 20, unlimited speed)': thumb({ noise: 20, maxSpeed: Infinity }),
  'fast thumb (noise 26, 600 px/s)': thumb({ noise: 26, maxSpeed: 600 }),
  'average thumb (noise 30, 420 px/s)': thumb({ noise: 30, maxSpeed: 420 }),
  'slow thumb (noise 34, 300 px/s)': thumb({ noise: 34, maxSpeed: 300 }),
};

console.log(`100-level gauntlet: ${RUNS} seeded runs per bot, cap ${CAP}s sim time, 3 lives for the whole campaign\n`);
for (const [name, bot] of Object.entries(BOTS)) {
  const t0 = Date.now();
  const b = runBatch({ createGame: mk, bot, maxSeconds: CAP }, RUNS);
  const lv = b.results.map((r) => r.stats.level).sort((a, c) => a - c);
  console.log(`${name}\n  wins ${b.wins}/${RUNS} (${(b.winRate * 100).toFixed(0)}%)  losses ${b.losses}  timeouts ${b.timeouts}` +
    `\n  level reached  avg ${b.stats.level.avg.toFixed(1)}  median ${lv[lv.length >> 1]}  min ${lv[0]}  max ${lv[lv.length - 1]}` +
    `\n  sim time/run   avg ${(b.secs.avg / 60).toFixed(0)} min  |  stalls/run ${b.stats.stalls.avg.toFixed(1)}  mercies/run ${b.stats.mercies.avg.toFixed(1)}  |  ${((Date.now() - t0) / 1000).toFixed(1)}s wall\n`);
}
