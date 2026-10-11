/**
 * controls.js - the two retro HUD buttons: Sound toggle (speaker) and Pause toggle (play / pause).
 *
 * They are real DOM <button>s layered above the input overlay (the overlay ignores everything outside the steering rail, and
 * would otherwise swallow the clicks), positioned in percentages of the stage so they track the scaled canvas.
 * Pure wiring: all state lives in the AnchorLoop (PLAY <-> PAUSE) and the audio module (muted by default).
 */
import { State } from './lib/anchor-loop.js';

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
  const mkBtn = (key, label) => {
    const b = doc.createElement('button'), box = HUD_BUTTONS[key];
    b.type = 'button'; b.setAttribute('aria-label', label); b.setAttribute('data-hud', key);
    Object.assign(b.style, {
      position: 'absolute', zIndex: '3', left: (box.x / W * 100) + '%', top: (box.y / H * 100) + '%', width: (box.w / W * 100) + '%', height: (box.h / H * 100) + '%',
      boxSizing: 'border-box', padding: '12%', margin: '0', background: '#000', color: '#9aa5ff', border: '2px solid #1d2350', borderRadius: '3px',
      cursor: 'pointer', touchAction: 'manipulation', outline: 'none', webkitTapHighlightColor: 'transparent',
    });
    stage.appendChild(b); return b;
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
