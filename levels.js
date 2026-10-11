/**
 * levels.js - procedural 100-level campaign. Pure and deterministic: generateLevel(i) always returns the same grid.
 *
 * A level is an array of 12-char rows ('.' empty, '#' Standard, 'S' Silver, 'G' Gold), exactly what Bricks.load() parses.
 * Level numbers n = index + 1 (1..100):
 *   rows    4 at level 1 growing smoothly to 11 at level 100
 *   silver  none before level 5, then a share of the bricks that grows from ~6% to 60%
 *   gold    none before level 15, then 1 mirrored pair (2 bricks) growing to 5 pairs (10 bricks) by level 95
 *   shape   level 1 is a solid wall; every later level carves a seeded pattern (pyramid, diamond, stripes, ...) out of its rows
 * Every level is left/right symmetric. Gold can never wall the field: it is placed only as isolated singles / mirrored pairs
 * (see validateLevel), so a wall spanning the 12 columns would need 12 touching gold bricks and is impossible by construction.
 */
export const COLS = 12;
export const CAMPAIGN_LEVELS = 100;
export const SILVER_FROM = 5, GOLD_FROM = 15;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The numbers that define a level's difficulty (exported for tests / tuning). */
export function levelSpec(n) {
  const rows = 3 + Math.ceil(n * 8 / 100);                                              // 4 .. 11
  const silverFrac = n < SILVER_FROM ? 0 : Math.min(0.6, 0.06 + (n - SILVER_FROM) * 0.0058);
  const goldPairs = n < GOLD_FROM ? 0 : Math.min(5, 1 + Math.floor((n - GOLD_FROM) / 20));
  return { n, rows, silverFrac, goldPairs };
}

const PATTERNS = ['full', 'pyramid', 'invpyramid', 'diamond', 'checker', 'stripes', 'columns', 'hollow'];

/** Is cell (r, c) part of the shape? Every pattern is symmetric about the vertical centre line. */
function inShape(p, r, c, rows) {
  const m = Math.min(c, COLS - 1 - c), d = Math.abs(c - 5.5), t = rows > 1 ? r / (rows - 1) : 0;
  switch (p) {
    case 'pyramid': return d <= 1.5 + t * 4;
    case 'invpyramid': return d <= 5.5 - t * 4;
    case 'diamond': { const mid = (rows - 1) / 2 || 1; return d <= Math.max(1.5, 5.5 - Math.abs(r - mid) * (4 / mid)); }
    case 'checker': return (r + m) % 2 === 0 || r === 0;
    case 'stripes': return r % 3 !== 2;
    case 'columns': return m % 3 !== 2 || r === 0;
    case 'hollow': return !(r >= 1 && r <= rows - 2 && d < 2.5);
    default: return true;
  }
}

/** @param {number} index 0-based level index (0..99; values outside are clamped) @returns {string[]} rows of 12 chars */
export function generateLevel(index) {
  const n = Math.max(1, Math.min(CAMPAIGN_LEVELS, Math.floor(index) + 1));
  const { rows, silverFrac, goldPairs } = levelSpec(n);
  const rnd = mulberry32(0xA11CE + n * 7919);
  let pattern = n === 1 ? 'full' : PATTERNS[(rnd() * PATTERNS.length) | 0];                // level 1 is the classic solid wall
  const grid = Array.from({ length: rows }, () => new Array(COLS).fill('.'));
  const carve = (p) => { for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) grid[r][c] = inShape(p, r, c, rows) ? '#' : '.'; };
  carve(pattern);
  let count = grid.flat().filter((x) => x === '#').length;
  if (count < 24) { pattern = 'full'; carve(pattern); }                                  // never a sparse, boring level

  // silver: decided on the left half, mirrored; a little more likely near the top
  let silvers = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < COLS / 2; c++) {
    if (grid[r][c] !== '#') continue;
    const p = silverFrac * (1.35 - 0.7 * (rows > 1 ? r / (rows - 1) : 0));
    if (rnd() < p) { grid[r][c] = grid[r][COLS - 1 - c] = 'S'; silvers++; }
  }
  if (n >= SILVER_FROM && silvers === 0) {                                              // level 5 etc. must introduce at least one
    const r0 = (n * 3) % rows, c0 = n % (COLS / 2);                                       // a different spot each level
    for (let k = 0; k < rows * (COLS / 2) && silvers === 0; k++) {
      const r = (r0 + ((c0 + k) / (COLS / 2) | 0)) % rows, c = (c0 + k) % (COLS / 2);
      if (grid[r][c] === '#') { grid[r][c] = grid[r][COLS - 1 - c] = 'S'; silvers++; }
    }
  }

  // gold: sparse, isolated; each placement replaces a brick (never an empty cell, never the top row)
  const golds = [];
  const touchesGold = (r, c, ignoreC) => { for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = r + dr, cc = c + dc; if ((dr || dc) && cc !== ignoreC && grid[rr] && grid[rr][cc] === 'G') return true; } return false; };
  const bricks = grid.flat().filter((x) => x !== '.').length, pairs = Math.min(goldPairs, Math.floor(bricks * 0.10 / 2));   // gold <= 10% of the bricks
  for (let placed = 0, tries = 0; placed < pairs && tries < 400; tries++) {
    const r = 1 + ((rnd() * (rows - 1)) | 0), c = (rnd() * (COLS / 2)) | 0, mc = COLS - 1 - c;
    if (grid[r][c] === '.' || touchesGold(r, c, mc) || touchesGold(r, mc, c)) continue;
    grid[r][c] = grid[r][mc] = 'G'; golds.push([r, c]); placed++;
  }
  return grid.map((row) => row.join(''));
}

/**
 * Structural checks every generated level must pass. @returns {{ok:boolean, problems:string[], stats:object}}
 *  - rows are 12 chars of . # S G, 1..14 rows, left/right symmetric
 *  - at least 8 destructible bricks
 *  - gold: no row or column made only of gold, and every 8-connected gold group has <= 2 bricks (so it can't span the field)
 */
export function validateLevel(rows) {
  const problems = [];
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 14) return { ok: false, problems: ['row count'], stats: {} };
  let std = 0, silver = 0, gold = 0;
  rows.forEach((row, r) => {
    if (row.length !== COLS || /[^.#SG]/.test(row)) problems.push(`row ${r} malformed`);
    for (let c = 0; c < COLS; c++) { if (row[c] !== row[COLS - 1 - c]) problems.push(`row ${r} not symmetric`); if (row[c] === '#') std++; else if (row[c] === 'S') silver++; else if (row[c] === 'G') gold++; }
    if (/^G+$/.test(row)) problems.push(`row ${r} is all gold`);
  });
  if (std + silver < 8) problems.push('fewer than 8 destructible bricks');
  const seen = new Set(); let biggest = 0;
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < COLS; c++) {
    if (rows[r][c] !== 'G' || seen.has(r * COLS + c)) continue;
    let size = 0; const st = [[r, c]]; seen.add(r * COLS + c);
    while (st.length) { const [y, x] = st.pop(); size++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx;
        if (rows[yy] && rows[yy][xx] === 'G' && !seen.has(yy * COLS + xx)) { seen.add(yy * COLS + xx); st.push([yy, xx]); } } }
    biggest = Math.max(biggest, size);
  }
  if (biggest > 2) problems.push(`gold group of ${biggest}`);
  return { ok: problems.length === 0, problems, stats: { rows: rows.length, std, silver, gold, biggestGoldGroup: biggest } };
}
