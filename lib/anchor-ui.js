/**
 * controls.js - the two retro HUD buttons: Sound toggle (speaker) and Pause toggle (play / pause).
 *
 * They are real DOM <button>s layered above the input overlay (the overlay ignores everything outside the steering rail, and
 * would otherwise swallow the clicks).
 * Pure wiring: all state lives in the AnchorLoop (PLAY <-> PAUSE) and the audio module (muted by default).
 */
import { State } from './anchor-loop.js';

/**
 * @param {{stage:HTMLElement, loop:object, audio:object, document?:Document}} o
 * @returns {{sound:HTMLElement, pause:HTMLElement, sync:()=>void, toggleSound:()=>boolean, togglePause:()=>boolean}}
 */
export function createControls({ stage, loop, audio, document: doc = document }) {
  const container = doc.createElement('div'); container.className = 'anchor-controls';
  Object.assign(container.style, {
    position: 'absolute', right: '10px', top: '10px', pointerEvents: 'none', zIndex: '3', display: 'flex', gap: '10px'
  });
  stage.appendChild(container);

  const mkBtn = (label) => {
    const b = doc.createElement('button');
    b.type = 'button'; b.setAttribute('aria-label', label);
    b.style.backgroundColor = 'transparent';
    b.style.border = 'none';
    b.style.outline = 'none';
    b.className = 'anchor-btn';
    b.style.color = 'var(--arcade-text-color, #FFFFFF)';   // theme hook; fallback = previous value
    b.style.textShadow = 'var(--arcade-glow, none)';
    b.style.fontSize = '24px';
    b.style.cursor = 'pointer';
    b.style.padding = '5px';
    b.style.pointerEvents = 'auto';
    container.appendChild(b);
    return b;
  };
  const sound = mkBtn('Sound'), pause = mkBtn('Pause');

  /** Re-render both buttons from the real state (call after any loop transition / toggle). */
  function sync() {
    const on = audio.enabled;
    sound.innerHTML = on ? '🔊' : '🔇';
    sound.setAttribute('aria-pressed', on ? 'true' : 'false');
    sound.setAttribute('aria-label', on ? 'Sound on' : 'Sound off (muted)');
    
    const st = loop.state, can = st === State.PLAY || st === State.PAUSE;
    pause.innerHTML = st === State.PAUSE ? '▶️' : '⏸️';
    pause.setAttribute('aria-label', st === State.PAUSE ? 'Resume' : 'Pause');
    pause.setAttribute('aria-pressed', st === State.PAUSE ? 'true' : 'false');
    pause.disabled = !can;
    pause.style.opacity = can ? '1' : '0.35';
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
 * @param {{stage:HTMLElement, W?:number, H?:number, hudH?:number, padLeft?:number, padRight?:number, document?:Document}} o
 *        hudH = height (logical px) of the HUD band the playfield starts below (Arktrix: HUD_H = 40).
 *        padLeft / padRight = logical px kept clear for the game's buttons (default: 64 for the left-side pixel buttons) and life icons.
 * @returns {((stats:{level:number, score:number, high:number})=>void) & {root:(HTMLElement|null)}}
 *          updateHUD(stats): call as often as you like (every frame is fine); the DOM is only touched when
 *          level, score or high actually changed. It is a harmless no-op without a DOM (headless Node tests).
 */
export function initAnchorHUD({ stage, W = 360, H = 640, hudH = 40, padLeft = 64, padRight = 120, document: doc } = {}) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  let root = null;
  if (d && stage) {
    root = d.createElement('div');
    root.id = 'anchor-hud'; root.className = 'anchor-hud';   // theme hooks: --arcade-text-color / -font / -glow / -label-color / -accent-color
    Object.assign(root.style, {
      position: 'absolute', left: '0', top: '0', width: '100%', height: (hudH / H * 100) + '%',
      boxSizing: 'border-box', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '0 ' + (padRight / W * 100) + '% 0 ' + (padLeft / W * 100) + '%',
      overflow: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: '2',
      color: 'var(--arcade-text-color, #fff)', fontFamily: 'var(--arcade-font, "Courier New", monospace)', fontWeight: 'bold', lineHeight: '1.05',
      textTransform: 'uppercase', textShadow: 'var(--arcade-glow, 1px 1px 0 #000)', fontSize: 'max(12px, 3.5vmin)'
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
    '<div class="anchor-hud-cell" style="text-align:center"><div class="anchor-hud-label" style="font-size:.62em;color:' + color + '">' + label + '</div><div class="anchor-hud-value" style="font-size:1.1em">' + value + '</div></div>';

  function updateHUD(stats) {
    if (typeof document === 'undefined' && !doc) return;  // headless Node: nothing to draw into
    if (!root || !stats) return;
    const level = Math.max(1, Math.floor(Number(stats.level)) || 1), score = Math.floor(Number(stats.score)) || 0, high = Math.floor(Number(stats.high)) || 0;
    if (level === pLevel && score === pScore && high === pHigh) return;   // dirty check: no DOM work on unchanged frames
    pLevel = level; pScore = score; pHigh = high;
    root.innerHTML = cell('LEVEL', level, 'var(--arcade-label-color, #9aa5ff)') + cell('SCORE', hudNum(score), 'var(--arcade-accent-color, #ff3b3b)') + cell('HI', hudNum(high), 'var(--arcade-accent-color, #ff3b3b)');
  }
  updateHUD.root = root;
  return updateHUD;
}
