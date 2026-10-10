# Shift

A small release-transition lab: leave an old tab open, activate a new build, continue the old journey, and inspect what happened to its module, synthetic session and draft.

**This repository contains an honest bounded experiment, not a production deployment verifier.** It never accepts arbitrary external target URLs. Public hosting is static, with no backend functions, accounts, uploads, telemetry, or external requests.

## Try the demo

[Open the Shift demo](https://project-bbih8.vercel.app/) with the bundled synthetic journal draft. No account or installation is needed.

1. **Cold failure:** select **Retire old assets**, leave **Load the lazy module before release** unchecked, then choose **Run experiment**. Expect **Failure captured** and the **Old lazy module unavailable** trace event. The missing fixture module is the expected result.
2. **Recovery:** choose **Recover in v2**. Expect **Restored in v2** and **Recovery verified**; the new fixture has restored the same draft and completed its synthetic journey.
3. Choose **Export JSON** before starting another experiment to keep the cold/recovery trace. Draft text, draft digests, synthetic session values and absolute URLs are omitted.
4. **Warm comparison:** keep **Retire old assets**, check **Load the lazy module before release**, and choose **Run experiment** again. Expect **Passed** and **Reused loaded module**: the old v1 journey completes using its already loaded module.
5. Choose **Export JSON** again to keep the warm trace. Compare its `warmModuleRegistry: true` with `false` in the cold trace. Starting a new run replaces the displayed trace.

This comparison demonstrates the document's module registry, not an HTTP-cache hit. The public demo simulates the release boundary; it does not switch a hosted deployment or test real authentication. **Replay trace** plays back recorded events without rerunning the journey.

For the separate Rust localhost controller, which can retire the same pinned module URL, see [Run and build](#run-and-build). Read [Limits and next validation gates](#limits-and-next-validation-gates) before interpreting either mode as production evidence.

## Two explicit execution modes

### Static browser fixture (published demo)

- Real same-origin v1 and v2 pages execute their own browser module code.
- Retired-assets scenario performs an actual module request to a deliberately unavailable fixture path. The deployment boundary itself is simulated; no hosting deployment is switched.
- Retained-assets scenario completes the old journey using its real module.
- Warm mode imports the module before transition and reuses the document's **module registry**. It is not called an HTTP-cache hit.
- Expired-session scenario is a synthetic application rule; its static JSON resource can have HTTP 200. It is never labelled a real authentication test.
- Recovery opens the real v2 fixture, restores the draft, loads its v2 continuation module and completes its synthetic session check.
- Rust/WASM validates transition order, bounds and outcome classification. If WASM fails to load, the experiment cannot run.

### Rust localhost fixture controller

Run `shift-fixture` on loopback. It serves both pinned builds on one origin. The same v1 lazy-module URL returns JavaScript before deployment and HTTP 410 after retirement. A new document uses v2. The normal browser cache and module registry are not intercepted or disabled.

Synthetic session expiry returns HTTP 401; the explicit fixture recovery renews that synthetic session and rechecks it. This controller serves only shipped fixture files. It is **not** an external reverse proxy, public runner, production server, trusted-HTTPS setup, or full release-skew testing platform.

## Run and build

Prerequisites: Rust 1.99.0 (pinned with rustfmt, Clippy and `wasm32-unknown-unknown` in `rust-toolchain.toml`) and Node.js 20+ for verification. No Cargo dependencies, frontend runtime packages, package installation, or paid services are needed to build or serve the demo. The optional browser test runner has its own locked development-only dependency.

```sh
rustup target add wasm32-unknown-unknown
./scripts/build.sh
node tests/wasm.mjs
cargo run --bin shift-fixture -- web
# Open http://127.0.0.1:4183 (the exact origin is deliberate).
```

The WASM asset is prebuilt and checked in for static hosting. `vercel.json` explicitly sets `framework: null`, skips package installation and runs `node scripts/check-static.mjs`. That gate verifies the prebuilt static files and instantiates their WASM without invoking Rust. It serves `web/` without backend functions or a Rust build requirement. `web/` can also be served with an ordinary static HTTP server on another origin/port to use static-fixture mode.

While the Rust controller is running:

```sh
node tests/controller.mjs
```

For reproducible browser verification, install the separate Playwright 1.62.1 runner using its lockfile. This is never installed by the Vercel build:

```sh
cd tests/browser-runner
npm ci --ignore-scripts
cd ../..
# Use an existing Chromium at /usr/bin/chromium, or set CHROMIUM_PATH.
node tests/browser.mjs
# Or test the static preview:
SHIFT_URL=https://your-authorized-preview.example node tests/browser.mjs
```

Playwright is an **external development/test runner**, never bundled in the public demo. `CHROMIUM_PATH` can select an installed compatible Chromium. The script uses no request routing or cache overrides. It writes real screenshots only after it executes successfully.

## What is checked

- 12 Rust domain unit tests: successful journey, retired asset recovery, expired session, unsafe/lost draft, invalid ordering, terminal cancellation, invalid ABI input, UTF-8 limits and exact resource routes.
- Seven Rust controller regressions cover header parsing, duplicates, transfer framing, header count, connection admission and absolute deadlines.
- Rust formatting and strict Clippy across all targets.
- 11 assertions against the exact compiled WASM binary, including the unsigned error sentinel at the JS boundary.
- 45 HTTP checks against the running Rust controller: deployment switching, asset cache headers, 410 retirement, v2 availability, session 401/renewal, unknown routes, origin checks and bounded run count.
- Nine raw HTTP rejection cases plus slow-client isolation, total deadline and connection-admission regressions are in `tests/controller-security.mjs`. Exact source/VM checks cover persistent error detail and cancellation during old-run cleanup; source-color checks cover focus-ring contrast.
- Browser test script covers cold/warm/retained/expired flows, recovery, cancellation/stale-result guard, reruns, event playback/stop, export redaction and a 390px viewport.

See `docs/VERIFICATION.md` for executed-versus-pending status. An unexecuted browser test is not a pass.

## Safety and resource limits

- Fixed routes only; no arbitrary file serving, outgoing proxy targets, uploads, backend functions or public processing endpoint.
- Local server binds only `127.0.0.1:4183`. It requires the exact Host, and mutations require same-origin POST. Unknown routes fail closed.
- At most eight active controller runs and eight concurrent connections; excess connections close immediately. Requests have 8 KB/64-header limits and a two-second total read/write budget from acceptance, rather than an inactivity timer. Nonzero request bodies, transfer encoding, duplicate or malformed headers are rejected. Static assets are limited to 1 MB, traces to 64 events, and drafts to 4096 UTF-8 bytes.
- Drafts use namespaced tab `sessionStorage`, removed on next run, cancellation and page exit. They are not sent to the server. Browser/process crashes can leave that tab's session data until the tab/session is closed.
- A SHA-256 comparison is used in memory to compare the saved/restored draft. **Neither the digest nor draft text nor synthetic session values are exported.** This is fixture continuity evidence, not source-media integrity certification.
- PostMessage traffic is restricted to the current iframe, exact origin, run ID and expected event types. Cancellation detaches waiters; stale run results cannot change the current trace.
- No HTML is built from input. Exports use JSON and a Blob download; CSP permits only same-origin resources and WASM.
- Trace replay is timed event playback, not deterministic browser replay.
- Resource-timing values are measured observations and are not automatically interpreted as cache-hit proof.

## Limits and next validation gates

No external production deployment, genuine identity provider, service-worker lifecycle, configured platform skew protection, actual Safari, physical phone, or trusted-HTTPS proxy experiment has been validated by this prototype. A phone-sized browser viewport is not a physical-device test. The localhost server is deliberately a single-process development fixture with bounded connection workers, not a hardened network service.

Future external experiments need owned/authorized targets, a trusted same-origin HTTPS controller, pinned versions, explicit retirement and recovery policy, authenticated private reports, and separate browser/device coverage. This repository does not silently substitute an arbitrary public proxy for that work.

Product value and differentiation against configured platform skew protection plus ordinary Playwright scripts are unproven. No user-study, demand, performance or production-readiness claims are made.

## Provenance

All implementation, UI, tests and synthetic fixture content were authored for this demo. No source code, data, configuration, commits or files were copied from existing user repositories. No external assets, analytics, remote fonts or third-party frontend libraries are bundled.

The Rust toolchain and Playwright are development tooling. Playwright 1.62.1 and its transitive integrity hashes are pinned in `tests/browser-runner/package-lock.json`; no browser package is installed in deployment builds. `Cargo.lock` records the zero-dependency Rust package. The prebuilt WASM hash and source manifest are recorded in `docs/BUILD-MANIFEST.sha256`.

Application source is MIT licensed; see `LICENSE`. As conservative distribution coverage, the exact Rust 1.99.0 standard-library notice is preserved at [third-party/rust-1.99.0/COPYRIGHT-library.html](third-party/rust-1.99.0/COPYRIGHT-library.html) and copied verbatim into the public output at [web/RUST-STANDARD-LIBRARY-NOTICES.html](web/RUST-STANDARD-LIBRARY-NOTICES.html). Its SHA-256 is 5647be074c8edf7339fd863055923a8fc80bc5610a8d4661ec3b767b9d392c27.

Zero Cargo dependencies alone does not establish that standard-library notice obligations are absent. This conservative packaging does not claim legal clearance or that every component in the upstream notice is linked into the 551-byte WASM. `third-party/manifest.json` records provenance and both distribution paths; the static build gate verifies both exact copies. The 1,499,465-byte notice is a separate, non-runtime static document and is not loaded by the app; the existing runtime resource limits are unchanged.
