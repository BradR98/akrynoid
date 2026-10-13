/**
 * controls.js - the two retro HUD buttons: Sound toggle (speaker) and Pause toggle (play / pause).
 *
 * They are real DOM <button>s layered above the input overlay (the overlay ignores everything outside the steering rail, and
 * would otherwise swallow the clicks), positioned in percentages of the stage so they track the scaled canvas.
 * Pure wiring: all state lives in the AnchorLoop (PLAY <-> PAUSE) and the audio module (muted by default).
 */
import { State } from './anchor-loop.js';

/** Logical (360x640) boxes the buttons occupy; game.js leaves the left of the HUD bar free for them. */
export const HUD_BUTTONS = Object.freeze({ sound: { x: 8, y: 7, w: 26, h: 26 }, pause: { x: 38, y: 7, w: 26, h: 26 } });

// 8x8 pixel-art icons: '#' = lit pixel
const ICONS = {
  speakerOn:  ['..#.....', '.##..#..', '####..#.', '####.#.#', '####.#.#', '####..#.', '.##..#..', '..#.....'],
  speakerOff: ['..#.....', '.##.#..#', '####.##.', '####..#.', '####.##.', '#####..#', '.##.....', '..#.....'],
  pause:      ['........', '.##..##.', '.##..##.', '.##..##.', '.##..##.', '.##..##.', '.##..##.', '........'],
  play:       ['........', '.#......', '.###....', '.#####..', '.#####..', '.###....', '.#......', '........'],
};
export function iconSvg(name, doc) {
  const NS = 'http://www.w3.org/2000/svg', svg = doc.createElementNS ? doc.createElementNS(NS, 'svg') : doc.createElement('svg');
  svg.setAttribute('viewBox', '0 0 8 8'); svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); svg.setAttribute('shape-rendering', 'crispEdges');
  ICONS[name].forEach((row, y) => { [...row].forEach((ch, x) => {
    if (ch !== '#') return;
    const r = doc.createElementNS ? doc.createElementNS(NS, 'rect') : doc.createElement('rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 1); r.setAttribute('height', 1); r.setAttribute('fill', 'currentColor'); svg.appendChild(r);
  }); });
  return svg;
}

/**
 * @param {{stage:HTMLElement, loop:object, audio:object, W?:number, H?:number, document?:Document}} o
 * @returns {{sound:HTMLElement, pause:HTMLElement, sync:()=>void, toggleSound:()=>boolean, togglePause:()=>boolean}}
 */
export function createControls({ stage, loop, audio, W = 360, H = 640, document: doc = document }) {
  const container = doc.createElement('div');
  Object.assign(container.style, {
    position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '3'
  });
  stage.appendChild(container);

  const mkBtn = (key, label) => {
    const b = doc.createElement('button'), box = HUD_BUTTONS[key];
    b.type = 'button'; b.setAttribute('aria-label', label); b.setAttribute('data-hud', key);
    Object.assign(b.style, {
      position: 'absolute', left: (box.x / W * 100) + '%', top: (box.y / H * 100) + '%', width: (box.w / W * 100) + '%', height: (box.h / H * 100) + '%',
      boxSizing: 'border-box', padding: '0', margin: '0', background: 'transparent', color: '#9aa5ff', border: 'none',
      cursor: 'pointer', touchAction: 'manipulation', outline: 'none', webkitTapHighlightColor: 'transparent', pointerEvents: 'auto'
    });
    container.appendChild(b); return b;
  };
  const sound = mkBtn('sound', 'Sound'), pause = mkBtn('pause', 'Pause');

  const setIcon = (btn, name) => { if (btn._icon === name) return; btn._icon = name; while (btn.firstChild) btn.removeChild(btn.firstChild); btn.appendChild(iconSvg(name, doc)); };

  /** Re-render both buttons from the real state (call after any loop transition / toggle). */
  function sync() {
    const on = audio.enabled;
    setIcon(sound, on ? 'speakerOn' : 'speakerOff');
    sound.setAttribute('aria-pressed', on ? 'true' : 'false'); sound.setAttribute('aria-label', on ? 'Sound on' : 'Sound off (muted)');
    sound.style.color = on ? '#fdd835' : '#6f7aa8';
    const st = loop.state, can = st === State.PLAY || st === State.PAUSE;
    setIcon(pause, st === State.PAUSE ? 'play' : 'pause');
    pause.setAttribute('aria-label', st === State.PAUSE ? 'Resume' : 'Pause'); pause.setAttribute('aria-pressed', st === State.PAUSE ? 'true' : 'false');
    pause.disabled = !can; pause.style.opacity = can ? '1' : '0.35'; pause.style.color = '#9aa5ff';
  }
  /** Sound button: flips the master mute. Runs inside the click, so the AudioContext unlocks on this very gesture. */
  function toggleSound() { audio.toggle(); sync(); return audio.enabled; }
  /** Pause button: PLAY <-> PAUSE through the Anchor state machine (ignored in every other state). */
  function togglePause() {
    const ok = loop.togglePause();
    if (ok) { if (loop.state === State.PAUSE) audio.suspend(); else audio.resume(); }
    sync(); return !!ok;
  }
  const swallow = (e) => { e.stopPropagation(); };                       // never let a button press reach the steering overlay
  for (const [btn, fn] of [[sound, toggleSound], [pause, togglePause]]) {
    btn.addEventListener('click', (e) => { swallow(e); fn(); });
    btn.addEventListener('pointerdown', swallow);
  }
  sync();
  return { sound, pause, sync, toggleSound, togglePause };
}

/* ------------------------------------------------------------------------------------------------------------------
 * Anchor HUD (opt-in). A DOM stats strip (Level / Score / High) that lives inside the HUD_H band of the stage, so games
 * can stop painting that text on the canvas. createControls() above is unaffected; games that never call this are unchanged.
 * ---------------------------------------------------------------------------------------------------------------- */

/** Pad a number to the classic 6-digit arcade readout; non-finite input reads as 0. */
const hudNum = (n) => String(Math.max(0, Math.floor(Number(n)) || 0)).padStart(6, '0');

/**
 * @param {{stage:HTMLElement, W?:number, H?:number, hudH?:number, document?:Document}} o
 *        hudH = height (logical px) of the HUD band the playfield starts below (Arktrix: HUD_H = 40).
 * @returns {((stats:{level:number, score:number, high:number})=>void) & {root:(HTMLElement|null)}}
 *          updateHUD(stats): call as often as you like (every frame is fine); the DOM is only touched when
 *          level, score or high actually changed. It is a harmless no-op without a DOM (headless Node tests).
 */
export function initAnchorHUD({ stage, W = 360, H = 640, hudH = 40, document: doc } = {}) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  let root = null;
  if (d && stage) {
    root = d.createElement('div');
    root.id = 'anchor-hud';
    Object.assign(root.style, {
      position: 'absolute', left: '0', top: '0', width: '100%', height: (hudH / H * 100) + '%',
      boxSizing: 'border-box', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      // keep clear of the sound / pause buttons on the left (x < 64 of 360) and of up to 5 life icons on the right
      padding: '0 ' + Math.round(120 / W * 100) + '% 0 ' + Math.ceil(64 / W * 100) + '%',
      overflow: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: '2',
      color: '#fff', fontFamily: '"Courier New", monospace', fontWeight: 'bold', lineHeight: '1.05',
      textTransform: 'uppercase', textShadow: '1px 1px 0 #000', fontSize: 'max(12px, 3.5vmin)'
    });
    // Scale with the stage (not the viewport) where container query units exist; the vmin value above is the fallback.
    try {
      if (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('width', '1cqw')) {
        stage.style.containerType = 'inline-size'; root.style.fontSize = 'max(12px, 3.5cqw)';
      }
    } catch (_) { /* keep the vmin fallback */ }
    stage.appendChild(root);
  }

  let pLevel = NaN, pScore = NaN, pHigh = NaN;           // NaN never equals anything: the first call always renders
  const cell = (label, value, color) =>
    '<div style="text-align:center"><div style="font-size:.62em;color:' + color + '">' + label + '</div><div style="font-size:1.1em">' + value + '</div></div>';

  function updateHUD(stats) {
    if (typeof document === 'undefined' && !doc) return;  // headless Node: nothing to draw into
    if (!root || !stats) return;
    const level = Math.max(1, Math.floor(Number(stats.level)) || 1), score = Math.floor(Number(stats.score)) || 0, high = Math.floor(Number(stats.high)) || 0;
    if (level === pLevel && score === pScore && high === pHigh) return;   // dirty check: no DOM work on unchanged frames
    pLevel = level; pScore = score; pHigh = high;
    root.innerHTML = cell('LEVEL', level, '#9aa5ff') + cell('SCORE', hudNum(score), '#ff3b3b') + cell('HI', hudNum(high), '#ff3b3b');
  }
  updateHUD.root = root;
  return updateHUD;
}
