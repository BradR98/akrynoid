# Backlog

Prioritised next steps for Arktrix (game `RR10021947`, build `v14`).

## Verify / fix (Phase 12 follow-ups)
- [ ] **Visual check on a real phone (360px) and desktop.** The DOM HUD is unit-tested but has not been looked at in a browser: confirm Level / Score / HI fit inside the 40px band, do not overlap the lives icons, and the font scales with the stage.
- [ ] **Lives icons vs emoji buttons.** Lives are drawn on canvas at the top right, in the same area as the Sound / Pause emoji buttons (`top:10px; right:10px`). They overlap. Move lives (e.g. left of centre, or under the bar) or move the buttons.
- [ ] **Anchor `anchor-ui.js` divergence.** `akrynoid` (emoji buttons) differs from the pixel-icon version in `mob-swarm`, `arkanoid` and `mob-swarm-2`. Decide the canonical `createControls`; until then do not run `sync-anchor.sh` from the workspace root.
- [ ] Push `main` to `origin` (local commits are ahead of `origin/main`).

## Gameplay
- [ ] Balance: the bot gauntlet shows only the unlimited-speed tracker clears 100 levels; "fast thumb" reaches level 52 (median), "average thumb" 14. Revisit speed ramp / lives for a human-completable campaign.
- [ ] Optionally show title / version in the PAUSE or START overlay (already drawn bottom-right on those screens).

## Docs / housekeeping
- [ ] README still says "Akrynoid"; the game was renamed Arktrix in Phase 10.
- [ ] Use the HUD in the other arcade games once the canonical Anchor UI is settled.
