// Seasonal themes: palettes render through the real draw(), default look is unchanged, gameplay colours are not themed.
import * as G from '../game.js';
import { AnchorInput } from '../lib/anchor-input.js';
import { AnchorLoop } from '../lib/anchor-loop.js';
import { generateLevel } from '../levels.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } };

/** Recording 2D context: every fillRect (and path fill(), e.g. the ball) is logged with the fillStyle in force. */
function recorder() {
  const log = []; let fs = '#000';
  const noop = () => {};
  const ctx = new Proxy({}, {
    get(_, k) { if (k === 'fillStyle') return fs; if (k === 'fillRect') return (x, y, w, h) => log.push({ c: fs, x, y, w, h }); if (k === 'fill') return () => log.push({ c: fs, shape: 'path' }); if (k === 'measureText') return () => ({ width: 0 }); return noop; },
    set(_, k, v) { if (k === 'fillStyle') fs = v; return true; }
  });
  return { ctx, log };
}
const make = (theme) => {
  const loop = new AnchorLoop({ update() {}, draw() {}, raf: null, autoPause: false });
  const game = G.createGame({ input: new AnchorInput({}), loop }, { storage: null, nameEntry: false, theme, levels: [generateLevel(0)] });
  loop.start(); return game;
};
const colours = (theme) => { const { ctx, log } = recorder(); make(theme).draw(ctx); return log; };
const has = (log, c) => log.some((e) => e.c === c);

const T = G.THEMES;
ok(T.default && T.spooky, 'THEMES has default and spooky');
ok(G.GAME_CONFIG.theme === 'spooky', 'GAME_CONFIG.theme is spooky');
ok(T.spooky.background === '#1a0b2e' && T.spooky.paddle === '#39ff14' && T.spooky.ball === '#f8f8ff', 'spooky: background / paddle / ball as specified');
ok(T.spooky.bricks.join() === '#ff7518,#8a0303,#4b0082' && T.spooky.hudText === '#ff7518', 'spooky: pumpkin / blood / purple bricks, orange hudText');
ok(T.default.background === '#05060f' && T.default.paddle === '#9aa5ff' && T.default.bricks.length === 8, 'default keeps the previous palette');

const sp = colours('spooky'), df = colours('default');
ok(sp[0].c === '#1a0b2e' && sp[0].w === 360 && sp[0].h === 640, 'spooky: full-canvas background fill');
ok(has(sp, '#39ff14') && has(sp, '#f8f8ff') && has(sp, '#ff7518') && has(sp, '#8a0303'), 'spooky: paddle, ball and brick colours are drawn');
ok(!has(sp, '#9aa5ff') && !has(sp, '#e53935'), 'spooky: no default-palette colours leak through');
ok(has(sp, '#0d0518') && has(sp, '#4b0082'), 'spooky: HUD bar and divider themed');
ok(df[0].c === '#05060f' && has(df, '#9aa5ff') && has(df, '#e53935') && has(df, '#000'), 'default: renders exactly the previous colours');
ok(colours('no-such-theme').some((e) => e.c === '#05060f'), 'unknown theme falls back to default');
const GOLD = '#d4a72c';
const goldLevel = (theme) => { const loop = new AnchorLoop({ update() {}, draw() {}, raf: null, autoPause: false }); const g = G.createGame({ input: new AnchorInput({}), loop }, { storage: null, nameEntry: false, theme, levels: [['GGGGGGGGGGGG']] }); loop.start(); const { ctx, log } = recorder(); g.draw(ctx); return log; };
ok(has(goldLevel('spooky'), GOLD) && has(goldLevel('default'), GOLD), 'gold bricks keep their gameplay colour in every theme');
console.log('\n' + pass + ' PASS, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
