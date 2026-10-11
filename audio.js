/**
 * audio.js - tiny retro synthesizer on the native Web Audio API (no audio files, no dependencies).
 *
 *   const audio = createAudio();            // muted by default; never throws, even without AudioContext (headless / old browsers)
 *   audio.setEnabled(true);                 // call from a user gesture (tap) - creates / resumes the context
 *   audio.play('brick');                    // no-op while muted
 *   audio.playEvent('wall');                // map a game event name to a sound (see EVENT_SOUNDS)
 *
 * Sounds: bounce (low square boop) | brick (decaying saw bip) | laser (fast descending sweep) |
 *         powerup (rising major arpeggio) | lifeLost (descending dissonant crunch)
 * Cheap on battery: nothing exists until the first unmuted sound; each voice is a one-shot oscillator that frees itself;
 * voices are capped and rate-limited per sound; suspend() lets the page sleep the context while paused.
 */
export const SOUNDS = ['bounce', 'brick', 'laser', 'powerup', 'lifeLost'];

/** Game event (see createGame's onEvent) -> sound. Events not listed are silent. */
export const EVENT_SOUNDS = Object.freeze({
  wall: 'bounce', paddle: 'bounce', hard: 'bounce', gold: 'bounce',     // everything that just bounces
  brick: 'brick', laser: 'laser', pickup: 'powerup', life: 'lifeLost',
});

const MAX_VOICES = 14, MIN_GAP = 0.03;                                    // simultaneous oscillators / min seconds between the same sound
const MASTER = 0.5;

/**
 * @param {object} [o]
 * @param {Function} [o.AudioContextClass]  injectable (tests); default window.AudioContext / webkitAudioContext
 */
export function createAudio(o = {}) {
  const Ctor = o.AudioContextClass !== undefined ? o.AudioContextClass
    : (typeof globalThis !== 'undefined' ? (globalThis.AudioContext || globalThis.webkitAudioContext) : undefined);
  let ctx = null, master = null, enabled = false, voices = 0, broken = false;
  const last = {};

  /** Create (once) and resume the context. Safe to call repeatedly; must first happen inside a user gesture on mobile. */
  function unlock() {
    if (!enabled || broken || typeof Ctor !== 'function') return false;
    try {
      if (!ctx) { ctx = new Ctor(); master = ctx.createGain(); master.gain.value = MASTER; master.connect(ctx.destination); }
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
      return true;
    } catch (_) { broken = true; ctx = null; return false; }
  }

  /** One oscillator voice: type, start/end frequency (Hz), duration (s), peak gain, start offset (s). */
  function tone(type, f0, f1, dur, vol, at = 0) {
    const t = ctx.currentTime + at, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    voices++; osc.onended = () => { voices--; try { g.disconnect(); } catch (_) {} };
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  const synth = {
    bounce:  () => tone('square', 170, 110, 0.07, 0.16),                                          // short low "boop"
    brick:   () => tone('sawtooth', 640 + Math.random() * 60, 360, 0.1, 0.13),                    // higher decaying "bip"
    laser:   () => tone('sawtooth', 1500, 180, 0.16, 0.09),                                       // "pew!"
    powerup: () => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('triangle', f, f, 0.12, 0.16, i * 0.06)); },   // C major arpeggio
    lifeLost: () => { tone('sawtooth', 233, 58, 0.55, 0.15); tone('square', 247, 62, 0.55, 0.1); tone('sawtooth', 165, 40, 0.6, 0.12); },  // clashing, falling crunch
  };

  const api = {
    /** True if this environment has a Web Audio implementation at all. */
    get supported() { return typeof Ctor === 'function' && !broken; },
    get enabled() { return enabled; },
    /** True once a context exists and is running. */
    get running() { return !!ctx && ctx.state === 'running'; },
    /** Mute / unmute. Unmuting should be called from a user gesture so the context can start. Returns the new state. */
    setEnabled(on) {
      enabled = !!on;
      if (enabled) unlock();
      else if (master) { try { master.gain.setValueAtTime(0, ctx.currentTime); master.gain.setValueAtTime(MASTER, ctx.currentTime + 0.05); } catch (_) {} }   // cut ringing tails
      return enabled;
    },
    toggle() { return api.setEnabled(!enabled); },
    unlock,
    /** Let the context sleep (e.g. while paused) / wake it again. */
    suspend() { try { if (ctx && ctx.state === 'running' && ctx.suspend) { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } } catch (_) {} },
    resume() { if (enabled) unlock(); },
    /** Play a named sound. Silent (and free) while muted, unsupported, or over the voice cap. Never throws. */
    play(name) {
      if (!enabled || broken || !synth[name]) return false;
      try {
        if (!ctx && !unlock()) return false;
        if (ctx.state !== 'running') { unlock(); if (ctx.state !== 'running') return false; }
        if (voices >= MAX_VOICES) return false;
        const t = ctx.currentTime; if (last[name] !== undefined && t - last[name] < MIN_GAP) return false;
        last[name] = t; synth[name](); return true;
      } catch (_) { return false; }
    },
    /** Map a game event to its sound (see EVENT_SOUNDS) and play it. */
    playEvent(name) { const s = EVENT_SOUNDS[name]; return s ? api.play(s) : false; },
  };
  return api;
}
