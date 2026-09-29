# Image question display — 29 September 2026

## Changes

- One shared image renderer preserves intrinsic proportions without a fixed crop, on host/player question screens, bonus questions, quiz previews, library cards, and content screens.
- Images fit the available width and viewport height. Tap/click to enlarge in a keyboard-accessible dialog; dismissing it retains typed answers and does not advance the host's game.
- Question editors preview the entered URL. Failed links show a retry action instead of a silent blank frame; replacing a URL resets its load/error state.
- Builder cards show real images rather than filenames. Narrow editor and live-question layouts put the sidebar below the content instead of squeezing images to zero width.
- Image URLs and independent quiz/game snapshots are unchanged. No database migration, upload service, or scoring changes are needed.

## Validation

- 410 unit tests; production build, TypeScript and lint passed.
- 90 browser checks passed across desktop/mobile Chromium and WebKit; two mobile-only smoke tests intentionally skip desktop projects.
- Browser regression suite covers landscape, portrait and square sizing, all supported mechanics plus legacy image questions, bonuses, content screens, URL errors/retry/replacement, draft preservation, host shortcuts, and quiz previews.
- Browser checks use controlled image/API fixtures, not production player data. External hosts must still permit public image access; expiring/private links or hotlink restrictions cannot be repaired by the display component.
