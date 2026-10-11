/**
 * game.js - Akrynoid core engine (Phase 2), built on the Anchor libraries.
 *
 *   createGame({ input, rng, loop }, opts?) -> game   DOM-free; satisfies the Anchor headless game contract
 *                                                    (update / observe / outcome / stats) plus draw(ctx).
 *   mount(stageEl, canvasEl)                         browser wiring: canvas scaling, AnchorInput, AnchorLoop.
 *
 * Phase 3 adds: split-screen input (rail steers, action zone fires/releases via input 'action'), an anti-stall monitor on
 * every ball, screen shake and a pooled particle emitter.
 *
 * Design notes
 *  - Paddle X is bound strictly to `input.getX()` (the input's clamp range is narrowed to keep the paddle on-screen).
 *  - Ball direction is a unit vector; speed is a separate scalar, so "constant speed" and "+2% per brick" are trivial.
 *  - Ball <-> brick collision uses row/col index math (at most a 2x2 cell neighbourhood per sub-step), never a full scan.
 *  - Everything that moves lives in a pre-allocated pool (balls, capsules, lasers): no allocation inside update/draw.
 *  - Game state is driven through the Anchor state machine: LEVEL_CLEAR when every Standard/Silver brick is gone,
 *    GAMEOVER when lives hit 0 (or the last level is cleared, which is flagged as a win).
 */
import { AnchorLoop, State } from './lib/anchor-loop.js';
import { AnchorInput } from './lib/anchor-input.js';

/* ----------------------------------------------------------------------------------------------- constants */
export const W = 360, H = 640;                       // logical board (portrait 9:16)
export const COLS = 12, BW = W / COLS, BH = 14;      // 12 x 30px bricks span the board exactly
export const GRID_TOP = 84, MAX_ROWS = 14;
export const HUD_H = 40;                             // top wall sits under the HUD bar
export const PADDLE_Y = 488, PADDLE_H = 12, PADDLE_W = 64, EXPAND_FACTOR = 1.5;
export const BALL_R = 5, BASE_SPEED = 280, SPEED_STEP = 1.02, MAX_SPEED_MULT = 1.8, MAX_BALLS = 8;
export const START_LIVES = 3, DROP_CHANCE = 0.10;
export const CAP_W = 30, CAP_H = 14, CAP_SPEED = 110, MAX_CAPSULES = 10;
export const LASER_SPEED = 520, LASER_COOLDOWN = 0.14, MAX_LASERS = 12;
export const STEER_FRAC = 0.2;                      // bottom 20% of the screen is the steering rail; the rest is the action zone
export const STALL_TIME = 3, STALL_VY = 0.3, STALL_VX = 0.05, STALL_NUDGE = 0.3;   // anti-stall (direction components, unit vector)
export const GOLD_SHAKE_MULT = 1.2;                  // ball speed multiplier from which a Gold hit shakes the screen
export const MERCY_MIN = 12, MERCY_MAX = 15;       // Mercy Aim: seconds without brick damage before the next bounce is nudged
export const MERCY_DEG_MIN = 3, MERCY_DEG_MAX = 5;  // ... by a random +- angle in this range (degrees)
export const MAX_PARTICLES = 128;
const MAX_STEP = 4;                                   // max px a ball travels per collision sub-step (anti-tunnelling)
const MIN_VY = 0.2;                                   // keeps the ball from going (near-)horizontal forever

/** Five paddle zones, left -> right: angle off vertical in radians. Centre zone adds up to +-CENTER_SPREAD. */
export const ZONE_ANGLES = [-60, -35, 0, 35, 60].map((d) => d * Math.PI / 180);
export const CENTER_SPREAD = 8 * Math.PI / 180;

export const KIND = Object.freeze({ EMPTY: 0, STANDARD: 1, SILVER: 2, GOLD: 3 });
export const SILVER_HP = 3;
const ROW_COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#8e24aa', '#ec407a'];
const SILVER_SHADES = ['', '#7d8696', '#aeb6c4', '#e8ecf3'];   // indexed by remaining HP
const CAP_TYPES = ['E', 'C', 'L', 'D'];
const CAP_COLORS = { E: '#1e88e5', C: '#43a047', L: '#e53935', D: '#00acc1' };

/**
 * Level grid legend (12 chars per row):  '.' empty   '#' Standard (1 HP, coloured by row)
 *                                        'S' Silver (3 HP)   'G' Gold (indestructible)
 */
export const LEVELS = [
  ['SSSSSSSSSSSS', '############', '############', '############', '############', '############'],
  ['G..........G', '.SSSSSSSSSS.', '############', '#G########G#', '############', '.##########.', '..########..'],
  ['.....##.....', '....####....', '...######...', '..SSSSSSSS..', '.##########.', 'G##########G', '.##G####G##.'],
];

/** Angle off vertical for a hit at `rel` (0 = paddle left edge, 1 = right edge). Exported for tests. */
export function reflectAngle(rel) {
  rel = rel < 0 ? 0 : rel > 1 ? 1 : rel;
  const scaled = rel * 5, z = scaled >= 5 ? 4 : scaled | 0;
  if (z === 2) return (scaled - 2.5) * 2 * CENTER_SPREAD;       // centre: mostly vertical, small spread
  return ZONE_ANGLES[z];
}

/* ------------------------------------------------------------------------------------------------ entities */
/** Vaus. X is a pure function of the input; width eases toward targetW (Expand). */
class Paddle {
  constructor() { this.x = W / 2; this.w = PADDLE_W; this.targetW = PADDLE_W; this.h = PADDLE_H; this.y = PADDLE_Y; }
  get top() { return this.y - this.h / 2; }
  reset() { this.w = this.targetW = PADDLE_W; }
  sync(input, dt) {
    this.w += (this.targetW - this.w) * Math.min(1, dt * 14);
    if (Math.abs(this.targetW - this.w) < 0.05) this.w = this.targetW;
    input.setBounds(this.w / 2, W - this.w / 2);               // paddle can never leave the board
    this.x = input.getX();
  }
}

/** Pooled ball. (dx,dy) is a unit vector; speed comes from the game. */
class Ball {
  constructor() { this.active = false; this.stuck = false; this.x = 0; this.y = 0; this.dx = 0; this.dy = -1; this.off = 0; this.flatT = 0; this.vertT = 0; }
  launch(angle) { this.stuck = false; this.dx = Math.sin(angle); this.dy = -Math.cos(angle); this.flatT = this.vertT = 0; }
  /**
   * Anti-stall monitor (passive; call once per step for a free-flying ball). If |vy| stays dangerously low (flat bounce) or
   * |vx| stays ~0 (pure vertical loop) for STALL_TIME seconds, nudge that component by STALL_NUDGE and renormalise.
   * The ball's velocity is (dx,dy)*speed, so the nudge is expressed on the unit direction. @returns {boolean} true if nudged
   */
  watch(dt) {
    this.flatT = Math.abs(this.dy) < STALL_VY ? this.flatT + dt : 0;
    this.vertT = Math.abs(this.dx) < STALL_VX ? this.vertT + dt : 0;
    if (this.flatT <= STALL_TIME && this.vertT <= STALL_TIME) return false;
    if (this.flatT > STALL_TIME) this.dy += (this.dy < 0 ? -1 : 1) * STALL_NUDGE;
    if (this.vertT > STALL_TIME) this.dx += (this.dx < 0 || (this.dx === 0 && this.x > W / 2) ? -1 : 1) * STALL_NUDGE;
    const n = Math.hypot(this.dx, this.dy); this.dx /= n; this.dy /= n;
    this.flatT = this.vertT = 0; return true;
  }
  /** Keep the ball from travelling (almost) horizontally. */
  guard() {
    if (Math.abs(this.dy) < MIN_VY) {
      this.dy = this.dy < 0 ? -MIN_VY : MIN_VY;
      this.dx = (this.dx < 0 ? -1 : 1) * Math.sqrt(1 - MIN_VY * MIN_VY);
    }
  }
}

/** Pooled particle emitter: ring buffer of fading, gravity-affected squares. Uses its own PRNG so VFX never perturb gameplay RNG. */
class Particles {
  constructor(n = MAX_PARTICLES) {
    this.n = n; this.head = 0; this.seed = 0x9e3779b9;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.vx = new Float32Array(n); this.vy = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.size = new Float32Array(n); this.col = new Array(n).fill('#fff');
  }
  rnd() { let s = this.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s >>> 0; return this.seed / 4294967296; }
  /** Burst of 5-10 squares in `color`, spraying outward. */
  burst(x, y, color) {
    const count = 5 + ((this.rnd() * 6) | 0);
    for (let k = 0; k < count; k++) {
      const i = this.head; this.head = (this.head + 1) % this.n;
      const a = this.rnd() * 6.2832, v = 50 + this.rnd() * 130;
      this.x[i] = x + (this.rnd() - 0.5) * BW * 0.6; this.y[i] = y + (this.rnd() - 0.5) * BH * 0.5;
      this.vx[i] = Math.cos(a) * v; this.vy[i] = Math.sin(a) * v - 60;
      this.life[i] = this.max[i] = 0.35 + this.rnd() * 0.35; this.size[i] = 2 + ((this.rnd() * 3) | 0); this.col[i] = color;
    }
  }
  step(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt; this.vy[i] += 520 * dt; this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt;
    }
  }
  draw(ctx) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      ctx.globalAlpha = this.life[i] / this.max[i]; ctx.fillStyle = this.col[i];
      ctx.fillRect(this.x[i] - this.size[i] / 2, this.y[i] - this.size[i] / 2, this.size[i], this.size[i]);
    }
    ctx.globalAlpha = 1;
  }
  get active() { let c = 0; for (let i = 0; i < this.n; i++) if (this.life[i] > 0) c++; return c; }
}

class Capsule { constructor() { this.active = false; this.x = 0; this.y = 0; this.type = 'E'; } }
class Laser { constructor() { this.active = false; this.x = 0; this.y = 0; } }

/** Brick grid in flat typed arrays; cell index i = row * COLS + col. */
class Bricks {
  constructor() {
    this.kind = new Uint8Array(COLS * MAX_ROWS); this.hp = new Uint8Array(COLS * MAX_ROWS);
    this.rows = 0; this.remaining = 0;                          // remaining = Standard + Silver bricks still alive
  }
  /** Level grid parser. Throws on malformed input so a bad level fails loudly. */
  load(rows) {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS) throw new RangeError(`level needs 1..${MAX_ROWS} rows`);
    this.kind.fill(0); this.hp.fill(0); this.remaining = 0; this.rows = rows.length;
    for (let r = 0; r < rows.length; r++) {
      const line = rows[r];
      if (line.length !== COLS) throw new RangeError(`level row ${r} must be ${COLS} chars, got ${line.length}`);
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        switch (line[c]) {
          case '.': case ' ': break;
          case '#': this.kind[i] = KIND.STANDARD; this.hp[i] = 1; this.remaining++; break;
          case 'S': this.kind[i] = KIND.SILVER; this.hp[i] = SILVER_HP; this.remaining++; break;
          case 'G': this.kind[i] = KIND.GOLD; this.hp[i] = 255; break;
          default: throw new RangeError(`level row ${r}: unknown brick '${line[c]}'`);
        }
      }
    }
  }
  /** @returns {0|1|2} 0 = no effect (empty / gold), 1 = damaged, 2 = destroyed */
  damage(i, amount) {
    const k = this.kind[i];
    if (k === KIND.EMPTY || k === KIND.GOLD) return 0;
    if (this.hp[i] > amount) { this.hp[i] -= amount; return 1; }
    this.hp[i] = 0; this.kind[i] = KIND.EMPTY; this.remaining--; return 2;
  }
}

/* ------------------------------------------------------------------------------------------------- the game */
/**
 * @param {{input:AnchorInput, rng?:()=>number, loop:AnchorLoop}} deps
 * @param {object} [opts]
 * @param {string[][]} [opts.levels]           level list (default LEVELS)
 * @param {(game:object)=>void} [opts.onLevelClear]  called right after loop enters LEVEL_CLEAR. It must eventually call
 *        game.nextLevel() then loop.start(). Default: advance immediately (headless / bots).
 * @param {(name:string, data?:any)=>void} [opts.onEvent]  'paddle','wall','brick','hard','gold','pickup','laser','life','levelclear','gameover'
 * @param {{getItem:Function,setItem:Function}|null} [opts.storage]  high-score persistence (default localStorage, if any)
 */
export function createGame({ input, rng = Math.random, loop }, opts = {}) {
  const levels = opts.levels || LEVELS;
  const emit = opts.onEvent || (() => {});
  const onLevelClear = opts.onLevelClear || ((g) => { g.nextLevel(); loop.start(); });
  let storage = null;
  try { storage = 'storage' in opts ? opts.storage : (typeof localStorage !== 'undefined' ? localStorage : null); } catch (_) { storage = null; }
  const HS_KEY = 'akrynoid.highscore';

  const paddle = new Paddle(), bricks = new Bricks();
  const balls = Array.from({ length: MAX_BALLS }, () => new Ball());
  const caps = Array.from({ length: MAX_CAPSULES }, () => new Capsule());
  const lasers = Array.from({ length: MAX_LASERS }, () => new Laser());

  let level = 0, lives = START_LIVES, score = 0, high = 0, destroyed = 0, minLives = START_LIVES;
  let speedMult = 1, catchOn = false, laserOn = false, laserCd = 0, won = false, stalls = 0, mercies = 0;
  let idleT = 0, mercyAt = 0, mercyArmed = false;       // Mercy Aim state (idleT = s since a brick was last damaged)
  let shake = 0, lastDraw = 0;
  const fx = new Particles();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const kick = (mag) => { if (mag > shake) shake = mag; };
  let scoreStr = '000000', highStr = '000000';
  const pad6 = (n) => String(n).padStart(6, '0');
  try { high = storage ? (parseInt(storage.getItem(HS_KEY), 10) || 0) : 0; } catch (_) { high = 0; }
  highStr = pad6(high);

  // scratch for brick collision (no per-frame allocation)
  let hitNx = 0, hitNy = 0;

  /* ---- helpers ---- */
  const speed = () => BASE_SPEED * speedMult;
  /** Restart the Mercy Aim countdown and pick the next trigger time in [MERCY_MIN, MERCY_MAX]. Uses the VFX PRNG, not gameplay rng. */
  function resetMercy() { idleT = 0; mercyArmed = false; mercyAt = MERCY_MIN + fx.rnd() * (MERCY_MAX - MERCY_MIN); }
  /** If armed, rotate this ball's direction by a random +-3..5 degrees (called on its paddle / wall bounce) to break geometric loops. */
  function applyMercy(b) {
    if (!mercyArmed) return;
    const a = (fx.rnd() < 0.5 ? -1 : 1) * (MERCY_DEG_MIN + fx.rnd() * (MERCY_DEG_MAX - MERCY_DEG_MIN)) * Math.PI / 180;
    const c = Math.cos(a), sn = Math.sin(a), dx = b.dx * c - b.dy * sn, dy = b.dx * sn + b.dy * c;
    b.dx = dx; b.dy = dy; b.guard(); b.flatT = b.vertT = 0;
    mercies++; resetMercy(); emit('mercy');
  }
  function addScore(n) { score += n; scoreStr = pad6(score); if (score > high) { high = score; highStr = scoreStr; } }
  function saveHigh() { try { if (storage && score >= high && score > 0) storage.setItem(HS_KEY, String(high)); } catch (_) {} }
  function acquireBall() { for (let i = 0; i < MAX_BALLS; i++) if (!balls[i].active) return balls[i]; return null; }
  function firstBall() { for (let i = 0; i < MAX_BALLS; i++) if (balls[i].active) return balls[i]; return null; }
  function anyStuck() { for (let i = 0; i < MAX_BALLS; i++) if (balls[i].active && balls[i].stuck) return true; return false; }
  function activeBalls() { let n = 0; for (let i = 0; i < MAX_BALLS; i++) if (balls[i].active) n++; return n; }
  function clearPools() { for (const c of caps) c.active = false; for (const l of lasers) l.active = false; for (const b of balls) b.active = false; }
  function resetPowerups() { catchOn = false; laserOn = false; paddle.reset(); }
  function serve() {
    const b = acquireBall(); b.active = true; b.stuck = true; b.off = 0; b.dx = 0; b.dy = -1;
    b.x = paddle.x; b.y = paddle.top - BALL_R;
  }

  /* ---- bricks ---- */
  function damageBrick(i, dmg, fromBall) {
    const kind = bricks.kind[i], res = bricks.damage(i, dmg);
    if (res === 0) {
      if (fromBall && kind === KIND.GOLD && speedMult >= GOLD_SHAKE_MULT) kick(3 + 4 * (speedMult - 1) / (MAX_SPEED_MULT - 1));   // hard knock at speed
      emit('gold'); return;
    }
    idleT = 0; mercyArmed = false;                                                        // any damage (hit or kill) counts as progress
    if (res === 1) { addScore(5); emit('hard'); return; }
    fx.burst(((i % COLS) + 0.5) * BW, GRID_TOP + ((i / COLS | 0) + 0.5) * BH, kind === KIND.SILVER ? SILVER_SHADES[1] : ROW_COLORS[(i / COLS | 0) % ROW_COLORS.length]);
    addScore(kind === KIND.SILVER ? 50 : 10);
    destroyed++; speedMult = Math.min(MAX_SPEED_MULT, speedMult * SPEED_STEP);
    emit('brick', kind);
    if (rng() < DROP_CHANCE) spawnCapsule(((i % COLS) + 0.5) * BW, GRID_TOP + ((i / COLS | 0) + 0.5) * BH, CAP_TYPES[(rng() * CAP_TYPES.length) | 0]);
  }
  function spawnCapsule(x, y, type) {
    for (const c of caps) if (!c.active) { c.active = true; c.x = x; c.y = y; c.type = type; return c; }
    return null;
  }

  /** Circle vs the 2x2-ish block of cells under the ball. Returns after resolving the single deepest hit. */
  function collideBricks(b) {
    if (b.y + BALL_R < GRID_TOP || b.y - BALL_R > GRID_TOP + bricks.rows * BH) return;
    let c0 = Math.floor((b.x - BALL_R) / BW), c1 = Math.floor((b.x + BALL_R) / BW);
    let r0 = Math.floor((b.y - BALL_R - GRID_TOP) / BH), r1 = Math.floor((b.y + BALL_R - GRID_TOP) / BH);
    if (c0 < 0) c0 = 0; if (c1 > COLS - 1) c1 = COLS - 1;
    if (r0 < 0) r0 = 0; if (r1 > bricks.rows - 1) r1 = bricks.rows - 1;
    let best = -1, bestD = Infinity;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * COLS + c;
      if (bricks.kind[i] === KIND.EMPTY) continue;
      const left = c * BW, top = GRID_TOP + r * BH;
      const px = b.x < left ? left : b.x > left + BW ? left + BW : b.x;
      const py = b.y < top ? top : b.y > top + BH ? top + BH : b.y;
      const nx = b.x - px, ny = b.y - py, d2 = nx * nx + ny * ny;
      if (d2 <= BALL_R * BALL_R && d2 < bestD) { bestD = d2; best = i; hitNx = nx; hitNy = ny; }
    }
    if (best < 0) return;
    const c = best % COLS, r = (best / COLS) | 0, left = c * BW, top = GRID_TOP + r * BH;
    if (bestD === 0) {                                          // centre is inside the brick: pick the shallow axis
      const ex = b.x - (left + BW / 2), ey = b.y - (top + BH / 2);
      if (Math.abs(ex) / BW > Math.abs(ey) / BH) { hitNx = ex >= 0 ? 1 : -1; hitNy = 0; b.x = ex >= 0 ? left + BW + BALL_R : left - BALL_R; }
      else { hitNx = 0; hitNy = ey >= 0 ? 1 : -1; b.y = ey >= 0 ? top + BH + BALL_R : top - BALL_R; }
    } else {                                                    // push the ball out along the contact normal
      const dist = Math.sqrt(bestD), push = (BALL_R - dist) / dist;
      b.x += hitNx * push; b.y += hitNy * push;
    }
    const ax = Math.abs(hitNx), ay = Math.abs(hitNy);
    if (ax > ay + 1e-6) b.dx = hitNx > 0 ? Math.abs(b.dx) : -Math.abs(b.dx);         // side hit -> flip X
    else if (ay > ax + 1e-6) b.dy = hitNy > 0 ? Math.abs(b.dy) : -Math.abs(b.dy);    // top/bottom hit -> flip Y
    else { b.dx = hitNx > 0 ? Math.abs(b.dx) : -Math.abs(b.dx); b.dy = hitNy > 0 ? Math.abs(b.dy) : -Math.abs(b.dy); }  // exact corner
    b.guard();
    damageBrick(best, 1, true);
  }

  /* ---- balls ---- */
  function moveBall(b, dt) {
    const dist = speed() * dt, n = Math.max(1, Math.ceil(dist / MAX_STEP)), h = dist / n;
    for (let s = 0; s < n && b.active; s++) {
      b.x += b.dx * h; b.y += b.dy * h;
      // walls: left, right, top
      if (b.x < BALL_R) { b.x = BALL_R; b.dx = Math.abs(b.dx); emit('wall'); applyMercy(b); }
      else if (b.x > W - BALL_R) { b.x = W - BALL_R; b.dx = -Math.abs(b.dx); emit('wall'); applyMercy(b); }
      if (b.y < HUD_H + BALL_R) { b.y = HUD_H + BALL_R; b.dy = Math.abs(b.dy); b.guard(); emit('wall'); applyMercy(b); }
      // paddle
      const top = paddle.top, left = paddle.x - paddle.w / 2, right = paddle.x + paddle.w / 2;
      if (b.dy > 0 && b.y + BALL_R >= top && b.y - BALL_R <= top + paddle.h && b.x >= left - BALL_R && b.x <= right + BALL_R) {
        b.y = top - BALL_R; emit('paddle');
        if (catchOn) { b.stuck = true; b.off = Math.max(-paddle.w / 2, Math.min(paddle.w / 2, b.x - paddle.x)); return; }
        b.launch(reflectAngle((b.x - left) / paddle.w)); applyMercy(b);
      }
      collideBricks(b);
      if (b.y - BALL_R > H) b.active = false;                   // bottom wall: ball lost
    }
  }
  function releaseStuck() {
    for (const b of balls) if (b.active && b.stuck) b.launch(reflectAngle(0.5 + b.off / paddle.w));
  }

  /* ---- power-ups ---- */
  function applyCapsule(type) {
    addScore(100); emit('pickup', type);
    switch (type) {
      case 'E': paddle.targetW = PADDLE_W * EXPAND_FACTOR; break;                       // Expand: +50% width
      case 'C': catchOn = true; laserOn = false; break;                                  // Catch (replaces Laser)
      case 'L': laserOn = true; catchOn = false; break;                                  // Laser (replaces Catch)
      case 'D': {                                                                        // Disruption: +2 balls from the current ball
        const src = firstBall(); if (!src) break;
        for (let k = -1; k <= 1; k += 2) {
          const nb = acquireBall(); if (!nb) break;
          const a = 0.35 * k, ca = Math.cos(a), sa = Math.sin(a);
          nb.active = true; nb.stuck = false; nb.off = 0; nb.x = src.x; nb.y = src.y;
          const bx = src.stuck ? 0 : src.dx, by = src.stuck ? -1 : src.dy;            // a stuck source launches its children upward
          nb.dx = bx * ca - by * sa; nb.dy = bx * sa + by * ca; nb.guard();
        }
        break;
      }
    }
  }
  function updateCapsules(dt) {
    for (const c of caps) {
      if (!c.active) continue;
      c.y += CAP_SPEED * dt;                                                             // strictly downward
      if (c.y - CAP_H / 2 > H) { c.active = false; continue; }
      if (c.y + CAP_H / 2 >= paddle.top && c.y - CAP_H / 2 <= paddle.top + paddle.h && Math.abs(c.x - paddle.x) <= paddle.w / 2 + CAP_W / 2) {
        c.active = false; applyCapsule(c.type);
      }
    }
  }
  function fireLasers() {
    if (laserCd > 0) return;
    let fired = 0;
    for (const l of lasers) {
      if (l.active) continue;
      l.active = true; l.y = paddle.top; l.x = paddle.x + (fired === 0 ? -1 : 1) * (paddle.w / 2 - 6);
      if (++fired === 2) break;
    }
    if (fired) { laserCd = LASER_COOLDOWN; emit('laser'); }
  }
  function updateLasers(dt) {
    for (const l of lasers) {
      if (!l.active) continue;
      const dist = LASER_SPEED * dt, n = Math.max(1, Math.ceil(dist / 6)), h = dist / n;
      for (let s = 0; s < n && l.active; s++) {
        l.y -= h;
        if (l.y < HUD_H) { l.active = false; break; }
        const r = Math.floor((l.y - GRID_TOP) / BH), c = Math.floor(l.x / BW);
        if (r >= 0 && r < bricks.rows && c >= 0 && c < COLS && bricks.kind[r * COLS + c] !== KIND.EMPTY) {
          damageBrick(r * COLS + c, 1, false); l.active = false;                                // 1 damage; gold just absorbs the shot
        }
      }
    }
  }

  /* ---- game flow ---- */
  function loadLevel() {
    bricks.load(levels[level]); clearPools(); resetPowerups(); speedMult = 1; laserCd = 0; resetMercy(); serve();
  }
  function loseLife() {
    lives--; minLives = Math.min(minLives, lives); emit('life', lives);
    clearPools(); resetPowerups(); speedMult = 1; kick(9); resetMercy();                                // velocity reset + shake
    if (lives > 0) serve(); else { saveHigh(); emit('gameover'); loop.gameOver(); }
  }

  const game = {
    /** Advance one simulation step (called by AnchorLoop only while PLAY). */
    update(dt) {
      paddle.sync(input, dt);
      if (laserCd > 0) laserCd -= dt;
      for (const b of balls) {
        if (!b.active) continue;
        if (b.stuck) { b.off = Math.max(-paddle.w / 2, Math.min(paddle.w / 2, b.off)); b.x = paddle.x + b.off; b.y = paddle.top - BALL_R; }
        else { moveBall(b, dt); if (b.active && b.watch(dt)) { stalls++; emit('stall'); } }
      }
      if (activeBalls() > 0 && !anyStuck()) { idleT += dt; if (idleT >= mercyAt) mercyArmed = true; }   // Mercy Aim clock (free-flying balls only)
      updateLasers(dt); updateCapsules(dt);

      if (bricks.remaining <= 0) {                                                       // win condition
        saveHigh(); emit('levelclear', level + 1);
        if (level + 1 >= levels.length) { won = true; emit('gameover'); loop.gameOver(); }
        else { loop.levelClear(); onLevelClear(game); }
        return;
      }
      if (activeBalls() === 0) loseLife();                                               // loss condition
    },

    /** Move to the next level (call while in LEVEL_CLEAR, then loop.start()). */
    nextLevel() { level = Math.min(level + 1, levels.length - 1); loadLevel(); },
    /** Fresh run (call from GAMEOVER, then loop.reset(); loop.start()). */
    restart() {
      level = 0; lives = START_LIVES; minLives = START_LIVES; score = 0; scoreStr = pad6(0); destroyed = 0; won = false;
      loadLevel(); stalls = 0; mercies = 0;
    },

    /** Render the whole frame to the main canvas (logical 360x640 coordinates). */
    draw(ctx) {
      ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, W, H);
      // VFX clock: wall-clock based so shake / particles keep animating on LEVEL_CLEAR and GAMEOVER screens too
      const t = now(), fdt = lastDraw ? Math.min(0.05, (t - lastDraw) / 1000) : 0; lastDraw = t;
      fx.step(fdt);
      shake *= Math.exp(-fdt * 10); if (shake < 0.2) shake = 0;
      ctx.save();
      if (shake > 0) ctx.translate((fx.rnd() - 0.5) * 2 * shake, (fx.rnd() - 0.5) * 2 * shake);
      // playfield frame
      ctx.fillStyle = '#0b0f26'; ctx.fillRect(0, HUD_H, W, H - HUD_H);

      // bricks
      for (let r = 0; r < bricks.rows; r++) for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c, k = bricks.kind[i];
        if (k === KIND.EMPTY) continue;
        const x = c * BW, y = GRID_TOP + r * BH;
        ctx.fillStyle = k === KIND.STANDARD ? ROW_COLORS[r % ROW_COLORS.length] : k === KIND.SILVER ? SILVER_SHADES[bricks.hp[i]] : '#d4a72c';
        ctx.fillRect(x + 1, y + 1, BW - 2, BH - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(x + 1, y + 1, BW - 2, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 1, y + BH - 3, BW - 2, 2);
        if (k === KIND.GOLD) { ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(x + 4, y + 5, 6, 2); }
      }

      fx.draw(ctx);

      // capsules
      ctx.font = 'bold 11px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const c of caps) {
        if (!c.active) continue;
        ctx.fillStyle = CAP_COLORS[c.type]; ctx.fillRect(c.x - CAP_W / 2 + 3, c.y - CAP_H / 2, CAP_W - 6, CAP_H);
        ctx.beginPath(); ctx.arc(c.x - CAP_W / 2 + 4, c.y, CAP_H / 2, 0, 6.2832); ctx.arc(c.x + CAP_W / 2 - 4, c.y, CAP_H / 2, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(c.type, c.x, c.y + 1);
      }

      // lasers
      ctx.fillStyle = '#ff5252';
      for (const l of lasers) if (l.active) ctx.fillRect(l.x - 1, l.y - 8, 2, 10);

      // paddle (Vaus)
      const px = paddle.x - paddle.w / 2;
      ctx.fillStyle = '#9aa5ff'; ctx.fillRect(px, paddle.top, paddle.w, paddle.h);
      ctx.fillStyle = laserOn ? '#ff5252' : catchOn ? '#43a047' : '#cfd8ff'; ctx.fillRect(px, paddle.top, 8, paddle.h); ctx.fillRect(px + paddle.w - 8, paddle.top, 8, paddle.h);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(px + 8, paddle.top + 1, paddle.w - 16, 2);

      // balls
      ctx.fillStyle = '#fff';
      for (const b of balls) if (b.active) { ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, 6.2832); ctx.fill(); }

      // HUD bar
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, HUD_H);
      ctx.fillStyle = '#1d2350'; ctx.fillRect(0, HUD_H - 2, W, 2);
      ctx.font = 'bold 11px "Courier New", monospace'; ctx.textBaseline = 'top';
      ctx.textAlign = 'left'; ctx.fillStyle = '#ff3b3b'; ctx.fillText('SCORE', 10, 5);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 15px "Courier New", monospace'; ctx.fillText(scoreStr, 10, 19);
      ctx.textAlign = 'center'; ctx.font = 'bold 11px "Courier New", monospace'; ctx.fillStyle = '#ff3b3b'; ctx.fillText('HIGH SCORE', W / 2, 5);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 15px "Courier New", monospace'; ctx.fillText(highStr, W / 2, 19);
      for (let l = 0; l < lives && l < 8; l++) {                                         // remaining lives as mini Vaus icons
        const lx = W - 12 - (l + 1) * 24 + 24;
        ctx.fillStyle = '#9aa5ff'; ctx.fillRect(lx - 22, 14, 20, 7);
        ctx.fillStyle = '#cfd8ff'; ctx.fillRect(lx - 22, 14, 4, 7); ctx.fillRect(lx - 6, 14, 4, 7);
      }

      // overlays driven by the Anchor state machine
      const st = loop.state;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (st === State.PLAY && anyStuck()) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = 'bold 13px "Courier New", monospace';
        ctx.fillText(level === 0 && destroyed === 0 ? 'ROUND 1 - TAP TO LAUNCH' : 'TAP TO LAUNCH', W / 2, 420);
      } else if (st !== State.PLAY) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, HUD_H, W, H - HUD_H);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 30px "Courier New", monospace';
        const title = st === State.START ? 'AKRYNOID' : st === State.PAUSE ? 'PAUSED' : st === State.LEVEL_CLEAR ? 'ROUND CLEAR' : (won ? 'YOU WIN' : 'GAME OVER');
        ctx.fillText(title, W / 2, 270);
        ctx.font = 'bold 14px "Courier New", monospace'; ctx.fillStyle = '#9aa5ff';
        const sub = st === State.START ? 'TAP TO START' : st === State.PAUSE ? 'TAP TO RESUME' : st === State.LEVEL_CLEAR ? 'GET READY...' : 'TAP TO RETRY';
        ctx.fillText(sub, W / 2, 310);
      }
      ctx.restore();
    },

    /* ---- Anchor headless contract ---- */
    observe() {
      const b = firstBall();
      return { ball: b ? { x: b.x, y: b.y } : { x: paddle.x, y: 0 }, paddleX: paddle.x, paddleW: paddle.w, stuck: anyStuck(),
               lives, score, level: level + 1, bricksLeft: bricks.remaining, balls: activeBalls() };
    },
    outcome: () => (won ? 'win' : 'lose'),
    stats: () => ({ score, level: level + 1, destroyed, minLives, lives, stalls, mercies }),
    get won() { return won; },
    get speedMult() { return speedMult; },
    get speed() { return speed(); },
    get flags() { return { catchOn, laserOn, expanded: paddle.targetW > PADDLE_W }; },
    /** Direct access to the pooled entities (tests / debug tooling). */
    get shake() { return shake; },
    get mercy() { return { idle: idleT, armed: mercyArmed, at: mercyAt }; },
    internals: { paddle, bricks, balls, caps, lasers, fx, spawnCapsule, applyCapsule, kick },
  };

  // Action zone (top 80%): launch caught balls, else fire lasers. Never touches paddle X. Registered before any UI handler
  // so a tap that merely starts / resumes the game (non-PLAY state) is not also treated as an in-game action.
  input.listen('action', () => {
    if (loop.state !== State.PLAY) return;
    if (anyStuck()) releaseStuck(); else if (laserOn) fireLasers();
  });

  loadLevel();
  return game;
}

/* -------------------------------------------------------------------------------------------- browser wiring */
/**
 * Wire the game into the page: scales the canvas (DPR capped at 2), builds the trackpad input, runs the Anchor loop.
 * @param {HTMLElement} stage   position:relative box that wraps the canvas
 * @param {HTMLCanvasElement} canvas
 */
export function mount(stage, canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  function resize() {
    const s = Math.min(innerWidth / W, innerHeight / H), dpr = Math.min(devicePixelRatio || 1, 2);
    stage.style.width = Math.floor(W * s) + 'px'; stage.style.height = Math.floor(H * s) + 'px';
    canvas.width = Math.floor(W * s * dpr); canvas.height = Math.floor(H * s * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }
  addEventListener('resize', resize); resize();

  let game = null, loop = null, advanceTimer = 0;
  const input = new AnchorInput({
    container: stage, width: W, height: H, steerFrac: STEER_FRAC, label: 'STEERING RAIL  -  slide to move  |  tap above to launch / fire',
    on: { onDown: uiTap, onAction: uiTap },       // any touch drives the menu screens (START / PAUSE / GAMEOVER)
  });
  function uiTap() {
    if (loop.state === State.START) loop.start();
    else if (loop.state === State.PAUSE) loop.resume();
    else if (loop.state === State.GAMEOVER) { game.restart(); loop.reset(); loop.start(); }
  }
  loop = new AnchorLoop({
    update: (dt) => game.update(dt),                       // update(delta) hook
    draw: () => game.draw(ctx),                            // draw(ctx) hook
  });
  game = createGame({ input, loop }, {
    onLevelClear: (g) => {                                 // hold the "ROUND CLEAR" screen briefly, then continue
      clearTimeout(advanceTimer);
      advanceTimer = setTimeout(() => { g.nextLevel(); loop.start(); }, 1500);
    },
  });
  loop.boot();
  return { game, loop, input };
}
