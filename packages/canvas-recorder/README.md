# Canvas recorder

`@pliflo/canvas-recorder` is a private Bun workspace package with no runtime
dependencies. It records Canvas 2D operations and encodes CCP1 pages with binary
PNG assets, or CCP2 pages with additional binary font resources, for
`crates/cairo-replay`.

Import it in the WebView, create a document-owned canvas, call
`recordCanvas(canvas)`, draw using the normal Canvas API, then await
`encodePage(canvas, widthPt, heightPt, fonts?)`. Images always use binary PNG assets.
Optional fonts are `{ family, weight, style, bytes }`; send each document face
once, before pages that use it. The host extracts/deobfuscates document fonts.
The recorder captures resolved text direction and joins adjacent, identically
styled draw calls only when their positions are contiguous and their boundary
splits a Unicode grapheme. Ordinary text, positioned spacing, and intervening
drawing operations remain separate.
Pliflo's `src/lib/cairo.ts` owns canvas cleanup.
Call `releaseCanvas(canvas)` in a `finally` block after `encodePage` settles.
It restores original context methods, drops recorded commands/image promises and
resets the backing canvas size. A released canvas must be recorded again before
encoding. The real-browser lifecycle check runs as part of `test:rendering`.

The package does not parse documents, resolve source paths, invoke Tauri or
manage print sessions. OOXML layout and worksheet geometry belong to the
application. Unsupported drawing must remain observable at recording/replay
validation boundaries.

Run `vp run test:protocol` from the repository root. Run
`vp run test:rendering <document> [...]` for the actual browser-to-Rust path.
Protocol changes must be verified against the Rust workspace tests as well.

The imported recorder and protocol retain the accompanying MIT license.
