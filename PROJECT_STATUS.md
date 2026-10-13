# Project Status

- **Game:** Arktrix (internal project ID `RR10021947`, not user-facing; used for storage keys / cache names), Arkanoid-style mobile PWA on the Anchor framework.
- **Build:** `v15` (`version.js`; `sw.js` cache `RR10021947-v15`).
- **Phase:** 11 (seasonal themes) on top of 12 (DOM HUD); active theme `spooky`.
- **Branch:** `main`; remote `origin` = github.com/BradR98/arktrix.

## State of the build
- 100-level procedural campaign, Top-10 leaderboard, save / auto-resume, Mercy Aim anti-stall, power-up capsules, PWA (manifest, icons, cache-first `sw.js`).
- HUD: Level / Score / High are DOM (`initAnchorHUD`, dirty-checked). Lives, bar background and divider are still canvas.
- Tests: `npm test` -> 37 + 118 + 61 + 28 + 11 + 12 checks, 0 failures (Node, no install).

## Known issues
- DOM HUD not yet visually verified in a browser.
- Lives icons overlap the Sound / Pause emoji buttons (top right).
- The bottom steering rail (`AnchorInput` in `lib/`) keeps its default navy styling and is not themed.
- Anchor `anchor-ui.js` differs between this repo and the other arcade repos (see BACKLOG).

## Next steps
See `BACKLOG.md`: visual check, lives / button layout, settle canonical Anchor UI, push.
