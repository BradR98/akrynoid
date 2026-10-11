import { AnchorLoop, State } from '../lib/anchor-loop.js';
import { AnchorInput } from '../lib/anchor-input.js';
import { mulberry32, createTester } from '../lib/anchor-headless.js';
import * as G from '../game.js';
import { generateLevel, validateLevel, levelSpec, CAMPAIGN_LEVELS, SILVER_FROM, GOLD_FROM } from '../levels.js';
import { loadBoard, saveBoard, qualifies, insertScore, cleanName, LB_KEY, LB_SIZE } from '../leaderboard.js';

const t = createTester();
const count = (rows, ch) => rows.join('').split(ch).length - 1;

// ---------------------------------------------------------------- procedural levels
{
  t.ok(CAMPAIGN_LEVELS === 100, 'campaign is 100 levels');
  const all = Array.from({ length: 100 }, (_, i) => generateLevel(i));
  const bad = all.map((L, i) => [i + 1, validateLevel(L)]).filter(([, v]) => !v.ok);
  t.ok(bad.length === 0, `all 100 levels pass validateLevel (symmetric, >=8 destructible, no gold wall)${bad.length ? ' - bad: ' + bad.map(([n, v]) => n + ':' + v.problems[0]).join(', ') : ''}`);
  t.ok(JSON.stringify(generateLevel(41)) === JSON.stringify(generateLevel(41)) && all.every((L, i) => JSON.stringify(L) === JSON.stringify(generateLevel(i))), 'generation is deterministic');
  const uniq = new Set(all.map((L) => L.join('|'))).size; t.ok(uniq >= 95, `levels are varied (${uniq}/100 distinct layouts)`);
  t.ok(all[0].length >= 3 && all[0].length <= 4 && count(all[0], '#') === all[0].length * 12 && count(all[0], 'S') + count(all[0], 'G') === 0, 'level 1: 3-4 full rows of Standard bricks only');
  t.ok(all.slice(1, 4).every((L) => L.length <= 5 && count(L, 'S') + count(L, 'G') === 0), 'levels 2-4: still short and Standard-only');
  const rows = all.map((L) => L.length);
  t.ok(rows[0] === 4 && rows[99] === 11 && rows.every((r, i) => i === 0 || r >= rows[i - 1]) && rows.every((r) => r <= 14), `row count grows smoothly and never shrinks (${rows[0]} -> ${rows[99]})`);
  t.ok(all.slice(0, SILVER_FROM - 1).every((L) => count(L, 'S') === 0), `no Silver before level ${SILVER_FROM}`);
  t.ok(count(all[SILVER_FROM - 1], 'S') >= 1, `Silver appears at level ${SILVER_FROM}`);
  const ratio = (L) => count(L, 'S') / Math.max(1, count(L, 'S') + count(L, '#'));
  const avg = (a, b) => all.slice(a, b).reduce((s, L) => s + ratio(L), 0) / (b - a);
  t.ok(avg(4, 20) < avg(30, 50) && avg(30, 50) < avg(60, 80) && avg(60, 80) < avg(80, 100), `Silver:Standard ratio rises with level (${avg(4, 20).toFixed(2)} < ${avg(30, 50).toFixed(2)} < ${avg(60, 80).toFixed(2)} < ${avg(80, 100).toFixed(2)})`);
  t.ok(all.slice(0, GOLD_FROM - 1).every((L) => count(L, 'G') === 0), `no Gold before level ${GOLD_FROM}`);
  const golds = all.map((L) => count(L, 'G'));
  t.ok(golds[GOLD_FROM - 1] >= 2 && golds[99] <= 10 && golds.every((g, i) => g <= 0.101 * (count(all[i], '#') + count(all[i], 'S') + g)), `Gold is sparse (${golds[GOLD_FROM - 1]} at L${GOLD_FROM} -> ${golds[99]} at L100, never >10% of bricks)`);
  const worst = Math.max(...all.map((L) => validateLevel(L).stats.biggestGoldGroup));
  t.ok(worst <= 2, `gold never clumps (largest 8-connected group = ${worst}); a 12-wide wall is impossible`);
  t.ok(all.every((L) => !L.some((r) => /^G+$/.test(r)) && ![...Array(12).keys()].some((c) => L.every((r) => r[c] === 'G'))), 'no all-gold row or column');
  // gold can't hide the last bricks: remove gold, the destructible set is unchanged by construction; also every level has bricks under open sky
  t.ok(all.every((L) => L[0].split('').some((c) => c === '#' || c === 'S')), 'every level has destructible bricks on its top row (always reachable)');
  const sp = levelSpec(50); t.ok(sp.rows === 7 && sp.silverFrac > 0.2 && sp.goldPairs === 2, 'levelSpec(50) = 7 rows, >20% silver, 2 gold pairs');
  t.ok(generateLevel(-5).join() === generateLevel(0).join() && generateLevel(500).join() === generateLevel(99).join(), 'out-of-range indices clamp');
  const v = validateLevel(['GG..........', '############']); t.ok(!v.ok, 'validateLevel rejects asymmetric / malformed grids');
  const v2 = validateLevel(['############', 'GGGGGGGGGGGG']); t.ok(!v2.ok && v2.problems.some((p) => /all gold/.test(p)), 'validateLevel rejects a solid gold wall');
  let loads = 0; try { const g = G.createGame({ input: new AnchorInput({}), loop: new AnchorLoop({ update() {}, draw() {}, raf: null, autoPause: false }) }, { storage: null }); for (let i = 0; i < 100; i++) { g.internals.bricks.load(generateLevel(i)); loads++; } } catch (e) { console.log(e.message); }
  t.ok(loads === 100, 'Bricks.load parses all 100 generated levels');
}

// ---------------------------------------------------------------- leaderboard module
{
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };
  t.ok(cleanName('br') === 'BR-' && cleanName('') === '---' && cleanName('a!b#cdef') === 'ABC' && cleanName(null) === '---' && cleanName('x9z') === 'X9Z', 'cleanName: A-Z0-9, upper-case, 3 chars, padded with -');
  let b = [];
  t.ok(qualifies(b, 1) && !qualifies(b, 0), 'empty table: any score > 0 qualifies, 0 does not');
  for (let i = 1; i <= 10; i++) b = insertScore(b, { name: 'AAA', score: i * 100, level: i }).board;
  t.ok(b.length === 10 && b[0].score === 1000 && b[9].score === 100 && b.every((e, i) => !i || b[i - 1].score >= e.score), 'table keeps 10 rows sorted high -> low');
  t.ok(!qualifies(b, 100) && !qualifies(b, 50) && qualifies(b, 101), 'full table: must BEAT 10th place (equal does not qualify)');
  const miss = insertScore(b, { name: 'ZZZ', score: 100, level: 1 }); t.ok(miss.rank === -1 && miss.board.length === 10 && miss.board[9].score === 100, 'a non-qualifying score is not inserted');
  const r = insertScore(b, { name: 'new', score: 550, level: 5 }); t.ok(r.rank === 5 && r.board[5].name === 'NEW' && r.board.length === 10 && r.board[9].score === 200 && b.length === 10 && b[9].score === 100, 'insert at rank 6 pushes 10th out; input not mutated');
  const tie = insertScore(b, { name: 'TIE', score: 1000, level: 1 }); t.ok(tie.rank === 1, 'ties rank below the existing equal score');
  const st = mem(); saveBoard(st, r.board); const back = loadBoard(st); t.ok(JSON.stringify(back) === JSON.stringify(r.board) && st.getItem(LB_KEY).length > 10, 'saves to / loads from localStorage');
  t.ok(loadBoard(null).length === 0 && loadBoard({ getItem: () => '{not json' }).length === 0 && loadBoard({ getItem: () => '{"a":1}' }).length === 0, 'corrupt / missing storage -> empty board');
  const dirty = loadBoard({ getItem: () => JSON.stringify([{ name: '<b>x</b>', score: 5.9, level: 'q' }, { score: -4 }, null, { name: 'OK', score: 'x' }, ...Array.from({ length: 20 }, (_, i) => ({ name: 'ABC', score: 100 + i, level: 1 }))]) });
  t.ok(dirty.length === 10 && dirty.every((e) => /^[A-Z0-9-]{3}$/.test(e.name) && Number.isInteger(e.score) && e.score > 0), 'hostile / junk entries are sanitised and capped at 10');
  t.ok(saveBoard({ setItem() { throw new Error('quota'); } }, b) === undefined, 'storage write errors are swallowed');
}

// ---------------------------------------------------------------- NAME_ENTRY flow (fake DOM, relative rail input, injected clock)
{
  const mkEl = () => { const o = { style: {}, children: [], listeners: {}, appendChild() {}, removeChild() {}, addEventListener(ty, f) { o.listeners[ty] = f; }, removeEventListener() {}, setAttribute() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 640 }) }; return o; };
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };
  const build = (seed = [], opts = {}) => {
    let clock = 0, game, loop; const storage = mem(); if (seed.length) saveBoard(storage, seed);
    const input = new AnchorInput({ container: mkEl(), document: { createElement: mkEl }, steerFrac: 0.2, relative: true, now: () => clock });
    loop = new AnchorLoop({ update: (d) => game.update(d), draw: () => {}, raf: null, caf: () => {}, now: () => 0, autoPause: false, maxDt: Infinity });
    game = G.createGame({ input, rng: mulberry32(3), loop }, { storage, now: () => clock, levels: [['#...........']], ...opts });
    loop.start(); input.feed(180, false);
    const L = input.el.listeners, pe = (x, y = 600) => ({ clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', buttons: 1, preventDefault() {} });
    const tick = (ms) => { clock += ms; };
    const tap = () => { L.pointerdown(pe(300)); tick(80); L.pointerup(pe(300)); tick(50); };
    const drag = (dx) => { L.pointerdown(pe(100)); tick(30); L.pointermove(pe(100 + dx)); tick(60); L.pointerup(pe(100 + dx)); tick(50); };
    const win = () => { const b = game.internals.balls[0]; b.active = true; b.stuck = false; b.x = 15; b.y = G.GRID_TOP + 14 + 4; b.dx = 0; b.dy = -1; game.update(1 / 300); };
    return { input, loop, game, storage, tick, tap, drag, win, L, pe, get clock() { return clock; } };
  };

  // qualifying win -> NAME_ENTRY
  const A = build();
  A.win();
  t.ok(A.loop.state === State.NAME_ENTRY && A.game.won, 'campaign win with a qualifying score enters NAME_ENTRY');
  A.tap(); t.ok(A.game.entry.name === '', 'touches in the first 0.7s are ignored (finger still down from play)');
  A.tick(800); A.drag(98); t.ok(A.game.entry.symbol === 'H' && A.loop.state === State.NAME_ENTRY, 'dragging +98px on the rail scrolls the wheel to H (14px per symbol); a drag is not a pick');
  A.tap(); t.ok(A.game.entry.name === 'H', 'tap picks the letter');
  A.drag(14); t.ok(A.game.entry.symbol === 'I', 'drag +14 -> next letter'); A.tap();
  A.drag(-14); A.drag(-14); t.ok(A.game.entry.symbol === 'G', 'scrolling works backwards too');
  A.drag(14); A.drag(14); A.drag(14); t.ok(A.game.entry.symbol === 'J', 'wheel wraps and tracks the finger');
  A.tap(); t.ok(A.game.entry.name === 'HIJ' && A.game.entry.symbol === 'END', 'third letter fills the name and jumps the wheel to END');
  A.drag(-14); t.ok(A.game.entry.symbol === 'DEL', 'DEL sits left of END'); A.tap(); t.ok(A.game.entry.name === 'HI', 'DEL removes the last letter');
  A.drag(-14 * 3); A.tap(); t.ok(A.game.entry.name.length === 3, 're-pick a letter after DEL');
  t.ok(A.game.entry.symbol === 'END', 'wheel sits on END'); A.tap();
  t.ok(A.loop.state === State.GAMEOVER && A.game.lastRank === 0, 'END saves -> back to GAMEOVER with the new row ranked #1');
  const saved = JSON.parse(A.storage.getItem(LB_KEY)); t.ok(saved.length === 1 && /^[A-Z]{3}$/.test(saved[0].name) && saved[0].score === A.game.leaderboard[0].score && saved[0].score > 0 && saved[0].level === 1, 'entry persisted to localStorage with name / score / level');
  t.ok(!A.game.canRestart(), 'the leaderboard screen is protected from an accidental restart tap'); A.tick(700); t.ok(A.game.canRestart(), '... but restartable shortly after');
  const ctxStub = new Proxy({}, { get: (_, p) => (p === 'globalAlpha' ? 1 : () => {}), set: () => true }); A.game.draw(ctxStub);
  const B = build(); B.win(); B.tick(800); B.game.entryKey('a'); B.game.entryKey('9'); B.game.entryKey('!'); B.game.entryKey('Backspace'); B.game.entryKey('b'); B.game.entryKey('c'); B.game.entryKey('d');
  t.ok(B.game.entry.name === 'ABC', 'keyboard: letters/digits type (max 3), Backspace deletes, junk keys ignored');
  B.game.entryKey('Enter'); t.ok(B.loop.state === State.GAMEOVER && /^[A-Z0-9]{3}$/.test(B.game.leaderboard[0].name), 'Enter saves');
  const E = build(); E.win(); E.tick(800); E.game.entryKey('Enter'); t.ok(E.loop.state === State.NAME_ENTRY, 'cannot save an empty name');

  // non-qualifying -> straight to GAMEOVER (leaderboard just displayed)
  const full = Array.from({ length: 10 }, (_, i) => ({ name: 'TOP', score: 99990 - i, level: 9 }));
  const C = build(full); C.win(); t.ok(C.loop.state === State.GAMEOVER && C.game.lastRank === -1 && C.game.leaderboard.length === 10, 'score below 10th place skips NAME_ENTRY');
  C.game.draw(ctxStub);
  // dying also qualifies
  const D = build([], { levels: [['############']] }); const b0 = D.game.internals.balls[0]; D.game.update(1 / 60);
  const hit = () => { const b = D.game.internals.balls[0]; b.active = true; b.stuck = false; b.x = 15; b.y = G.GRID_TOP + 14 + 4; b.dx = 0; b.dy = -1; D.game.update(1 / 300); };
  hit(); const sc = D.game.stats().score; t.ok(sc > 0, 'scored some points');
  for (let k = 0; k < 3; k++) { const b = D.game.internals.balls.find((q) => q.active); b.stuck = false; b.x = 330; b.y = G.H + 20; b.dy = 1; b.dx = 0; D.game.update(1 / 60); }
  t.ok(D.loop.state === State.NAME_ENTRY && !D.game.won, 'losing the last life with a Top-10 score enters NAME_ENTRY');
  // score 0 never qualifies
  const Z = build([], { levels: [['############']] }); for (let k = 0; k < 3; k++) { const b = Z.game.internals.balls.find((q) => q.active); b.stuck = false; b.x = 330; b.y = G.H + 20; b.dy = 1; b.dx = 0; Z.game.update(1 / 60); }
  t.ok(Z.loop.state === State.GAMEOVER, 'zero score never enters the table');
  // a new game after the board screen keeps the board and the paddle works again
  A.game.restart(); A.loop.reset(); A.loop.start(); A.input.feed(180, false); A.game.update(1 / 60);
  t.ok(A.loop.state === State.PLAY && A.game.leaderboard.length === 1 && A.game.internals.paddle.x >= A.game.internals.paddle.w / 2, 'restart keeps the saved board and restores paddle bounds');
}

// ---------------------------------------------------------------- extra-life pill (P)
{
  const mkG = () => { const input = new AnchorInput({}); const loop = new AnchorLoop({ update: (d) => game.update(d), draw() {}, raf: null, caf: () => {}, now: () => 0, autoPause: false, maxDt: Infinity });
    const game = G.createGame({ input, rng: () => 0, loop }, { storage: null, nameEntry: false, levels: Array(12).fill(['############', '############']) }); loop.start(); return { game, loop, input, I: game.internals }; };
  const dropType = (g) => { const b = g.I.balls[0]; g.I.caps.forEach((c) => { c.active = false; }); b.active = true; b.stuck = false; b.x = 15; b.y = G.GRID_TOP + 2 * 14 + 4; b.dx = 0; b.dy = -1; g.game.update(1 / 300);
    const c = g.I.caps.find((q) => q.active); return c ? c.type : null; };
  const g = mkG();
  for (let lvl = 1; lvl <= 12; lvl++) {
    const ty = dropType(g);
    if (lvl === 1 || lvl === 10) t.ok(ty && ty !== 'P', `level ${lvl}: drop is never P (got ${ty})`);
    if (lvl === 11) t.ok(ty === 'P', `level ${lvl}: P can drop (rng forced -> ${ty})`);
    g.game.nextLevel();
  }
  const h = mkG(), x0 = h.I.paddle.x, caps = h.I;
  h.input.feed(180, false); h.game.update(1 / 60);
  const lives0 = h.game.observe().lives; caps.spawnCapsule(h.I.paddle.x, h.I.paddle.top, 'P'); h.game.update(1 / 60);
  t.ok(h.game.observe().lives === lives0 + 1, 'catching P grants +1 life');
  for (let k = 0; k < 6; k++) { caps.spawnCapsule(h.I.paddle.x, h.I.paddle.top, 'P'); h.game.update(1 / 60); }
  t.ok(h.game.observe().lives === G.MAX_LIVES, `lives cap at ${G.MAX_LIVES}`);
  const sc = h.game.observe().score; caps.spawnCapsule(h.I.paddle.x, h.I.paddle.top, 'P'); h.game.update(1 / 60);
  t.ok(h.game.observe().lives === G.MAX_LIVES && h.game.observe().score >= sc + G.EXTRA_LIFE_BONUS, 'at the cap, P pays a score bonus instead');
}

process.exit(t.summary());
