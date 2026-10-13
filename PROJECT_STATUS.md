# Project Status

- **Game:** Arktrix (engine id `RR10021947`), Arkanoid-style mobile PWA on the Anchor framework.
- **Build:** `v14` (`version.js`; `sw.js` cache `RR10021947-v14`).
- **Phase:** 12 - opt-in DOM HUD, implemented and committed locally; not pushed.
- **Branch:** `main`; remote `origin` = github.com/BradR98/arktrix.

## State of the build
- 100-level procedural campaign, Top-10 leaderboard, save / auto-resume, Mercy Aim anti-stall, power-up capsules, PWA (manifest, icons, cache-first `sw.js`).
- HUD: Level / Score / High are DOM (`initAnchorHUD`, dirty-checked). Lives, bar background and divider are still canvas.
- Tests: `npm test` -> 37 + 118 + 61 + 28 + 11 checks, 0 failures (Node, no install).

## Known issues
- DOM HUD not yet visually verified in a browser.
- Lives icons overlap the Sound / Pause emoji buttons (top right).
- Anchor `anchor-ui.js` differs between this repo and the other arcade repos (see BACKLOG).

## Next steps
See `BACKLOG.md`: visual check, lives / button layout, settle canonical Anchor UI, push.
