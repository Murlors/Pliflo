# Canvas recorder

`@pliflo/canvas-recorder` is a private Bun workspace package with no runtime
dependencies. It records Canvas 2D operations and encodes CCP1 pages, including
binary PNG assets, for `crates/cairo-replay`.

Import it in the WebView, create a document-owned canvas, call
`recordCanvas(canvas)`, draw using the normal Canvas API, then await
`encodePage(canvas, widthPt, heightPt)`. Images always use binary PNG assets.
Pliflo's `src/lib/cairo.ts` owns canvas cleanup.

The package does not parse documents, resolve source paths, invoke Tauri or
manage print sessions. OOXML layout and worksheet geometry belong to the
application. Unsupported drawing must remain observable at recording/replay
validation boundaries.

Run `vp run test:protocol` from the repository root. Run
`vp run test:rendering <document> [...]` for the actual browser-to-Rust path.
Protocol changes must be verified against the Rust workspace tests as well.

The imported recorder and protocol retain the accompanying MIT license.
