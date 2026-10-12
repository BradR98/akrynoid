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
  const container = doc.createElement('div');
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
    b.style.color = '#FFFFFF';
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
