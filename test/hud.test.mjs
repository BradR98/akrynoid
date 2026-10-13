// initAnchorHUD: headless safety, dirty-checking, escaping-by-construction, layout props.
import { initAnchorHUD } from '../lib/anchor-ui.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } };

// 1. no DOM at all (headless Node): must neither throw nor render
const noop = initAnchorHUD({ stage: {} });
let threw = false; try { noop({ level: 1, score: 5, high: 9 }); noop(); } catch (_) { threw = true; }
ok(!threw && noop.root === null, 'no DOM: init + update are harmless no-ops');

// 2. fake DOM
let sets = 0;
const mk = () => { const el = { style: {}, children: [], _h: '', appendChild(c) { this.children.push(c); }, set innerHTML(v) { sets++; this._h = v; }, get innerHTML() { return this._h; } }; return el; };
const doc = { createElement: mk };
const stage = mk();
const hud = initAnchorHUD({ stage, document: doc, hudH: 40 });
ok(stage.children[0] === hud.root && hud.root.id === 'anchor-hud', 'root #anchor-hud appended to stage');
ok(hud.root.style.pointerEvents === 'none' && hud.root.style.whiteSpace === 'nowrap' && hud.root.style.display === 'flex' && hud.root.style.justifyContent === 'space-between', 'responsive flex layout, click-through');
ok(Math.abs(parseFloat(hud.root.style.height) - 6.25) < 1e-9, 'height = HUD_H / H (40 / 640 = 6.25%)');
hud({ level: 3, score: 1200, high: 24000 });
ok(sets === 1 && /LEVEL/.test(hud.root.innerHTML) && />3</.test(hud.root.innerHTML) && /001200/.test(hud.root.innerHTML) && /024000/.test(hud.root.innerHTML), 'first call renders level / score / high (6-digit padded)');
for (let i = 0; i < 100; i++) hud({ level: 3, score: 1200, high: 24000 });
ok(sets === 1, '100 unchanged calls touch the DOM 0 times (dirty check)');
hud({ level: 3, score: 1210, high: 24000 }); ok(sets === 2, 'score change re-renders');
hud({ level: 4, score: 1210, high: 24000 }); ok(sets === 3, 'level change re-renders');
hud({ level: 4, score: 1210, high: 25000 }); ok(sets === 4, 'high change re-renders');
hud({ level: '<img src=x onerror=1>', score: NaN, high: undefined }); ok(!/<img/.test(hud.root.innerHTML) && /000000/.test(hud.root.innerHTML), 'hostile / non-numeric input is coerced to numbers (no markup injection)');
const before = sets; hud(); hud(null); ok(sets === before, 'missing stats is ignored');
console.log('\n' + pass + ' PASS, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
