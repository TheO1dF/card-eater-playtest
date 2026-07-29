# Card Eater repository guidance

## Browser verification

- Use Microsoft Edge for this repository's UI and gameplay smoke tests.
- Run `npm run check` first, then serve the static build locally and run `scripts/browser-smoke.mjs` against headless Edge at both mobile and desktop viewports.
- Save screenshots and the JSON report under a versioned `.artifacts/smoke-*` directory.
- A missing Chrome extension connection must not block Edge verification.
