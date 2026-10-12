# First use: cold failure, recovery, and warm reuse

Open the [Shift demo](https://project-bbih8.vercel.app/) with its bundled synthetic journal draft. No account or personal input is needed.

These expectations come from the [pinned source](https://github.com/Emin-dev/shift/blob/68fec96d55723d3bf91dc17ce69e92ef2fb3e354/README.md) and tests, not a new browser run. This guide does not verify which commit the live demo currently serves.

## Try it

1. Select **Retire old assets**. Leave **Load the lazy module before release** unchecked, then choose **Run experiment**.
2. Expect **Failure captured** and the trace event **Old lazy module unavailable**.
3. Choose **Recover in v2**. Expect **Restored in v2** and **Recovery verified**.
4. Choose **Export JSON** before another run. Keep this as the cold/recovery report.
5. Keep **Retire old assets**, check **Load the lazy module before release**, and choose **Run experiment** again.
6. Expect **Passed** and **Reused loaded module**. Export again and keep the two files separately; both downloads use the same scenario-based filename.

## Read the reports

The cold/recovery report has `warmModuleRegistry: false`; the warm report has `true`. After successful recovery, `draftPreserved` is `true`. Draft text, draft digests, synthetic session values and absolute URLs are omitted.

Starting another run replaces the displayed trace. **Replay trace** plays back recorded events; it does not rerun the experiment.

The warm result demonstrates the document's module registry, not an HTTP-cache hit. The static demo simulates deployment switching and session rules. It does not test an external deployment or real authentication. Actual Safari and physical-phone behavior are not established by this guide.

## Source and verification

- [Browser assertions](https://github.com/Emin-dev/shift/blob/68fec96d55723d3bf91dc17ce69e92ef2fb3e354/tests/browser.mjs)
- [Report fields and export implementation](https://github.com/Emin-dev/shift/blob/68fec96d55723d3bf91dc17ce69e92ef2fb3e354/web/app.js)
- [Recorded verification and limits](VERIFICATION.md)
