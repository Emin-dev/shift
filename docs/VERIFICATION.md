# Writer verification — 2026-10-09

## Passed against the built source

- `cargo fmt --check`
- `cargo test --locked`: 12 unit tests; no failed or ignored tests.
- `cargo clippy --all-targets -- -D warnings`
- Release WASM build for `wasm32-unknown-unknown`.
- `node --check web/app.js` and `node --check web/fixtures/frame.js`.
- `node tests/wasm.mjs`: 11 assertions against `web/assets/shift_core.wasm`.
- `node tests/controller.mjs`: 45 assertions against a newly built running Rust fixture controller.
- Zero Cargo dependencies; static public output contains no backend functions.

The actual WASM execution caught a JS signed-i32/u32 sentinel mismatch. The browser boundary now normalizes the result with `>>> 0`; negative-path WASM tests cover it.

## Not yet passed

- Browser UI execution, screenshots and real visual/keyboard validation remain pending.
- Chromium initialization was blocked by the test environment's IPC restrictions.
- The supported cloud browser was attempted against the executor's `http://127.0.0.1:4183` and returned `ERR_CONNECTION_REFUSED`; it does not share this executor's loopback namespace.
- `tests/browser.mjs` is a runnable test artifact, not an assertion that those tests have executed.
- Browser/visual checks require an accessible preview URL in the supported browser or a test runtime with Chromium IPC available.
- Independent review and final hosted deployment verification are not claimed by this implementation record.

## Explicitly outside tested scope

External deployment proxying, Safari, physical phones, real identity providers, HTTPS deployment transitions, service-worker updates, production performance and end-user product validation.

## Independent-review corrections — revision 2

The original snapshot and reviewer evidence were preserved outside this app. This record adds the retest; it does not rewrite the original findings into passes.

- Controller security: parse only bytes before the first CRLFCRLF terminator. Reject duplicate/malformed headers, request bodies, transfer encoding and oversized headers. Nine raw-request negative cases now return 4xx.
- Concurrency: eight admitted connection workers; socket reads and writes do not hold the state lock. One normal request finished in 1 ms alongside a drip-fed header, and the slow connection closed at 2004 ms against the two-second absolute request budget. A ninth concurrent connection was promptly closed. These are local regression observations, not production performance claims.
- Added seven Rust controller unit tests; total native tests now 19 (12 domain + 7 controller). All pass with formatting and strict Clippy.
- The original 45 HTTP assertions and 11 compiled WASM assertions still pass. Raw security results are in `SECURITY-REGRESSION-RESULTS.txt`.
- `tests/review-regressions.mjs` executes exact message-helper code in a VM and checks that startup/run errors remain visible after status changes. It also verifies the false Chromium assertion is absent and the static Vercel build is explicit.
- The focus color is now #45682e. Source-derived contrast is 5.22–6.42:1 against the five tested adjacent backgrounds. Focus behavior/clipping remain browser-pending.
- `tests/cancel-regression.mjs` executes the exact run function with controlled cleanup promises. Both normal cleanup resolution and AbortError after Cancel result in zero new controller resets, cancelled phase, correct run ownership and busy=false.
- `vercel.json` now pins framework:null and `node scripts/check-static.mjs`, with package installation explicitly skipped. The smoke gate passes with the Rust bin directory absent from PATH. Hosted build verification still belongs to deployment QA.
- Rust 1.99.0, wasm target, rustfmt and Clippy are pinned. Playwright 1.62.1 has a separate development-only package and registry-generated integrity lockfile; no browser was installed or launched during these corrections.
- Browser verification remains pending. The public UI now states that accurately.

## Conservative distribution-notice coverage

The verbatim standard-library notice from the pinned Rust 1.99.0 distribution is preserved in source and public output. The static gate checks both copies against SHA-256 5647be074c8edf7339fd863055923a8fc80bc5610a8d4661ec3b767b9d392c27 and the exact 1,499,465-byte size. This is conservative notice coverage, not legal clearance or a claim that every listed component is linked into this WASM. Runtime code, UI, and resource limits were unchanged by this documentation packaging step.
