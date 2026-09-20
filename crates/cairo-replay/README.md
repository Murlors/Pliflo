# Rust Cairo/Pango renderer

`canvas-cairo-replay` exposes a Rust library (`canvas_cairo_replay`) and the
`canvas-cairo-pdf` binary. It renders Canvas recording v1 to PDF;
it does not lay out Office documents or submit print jobs.

## Build and run

Install Rust and native Cairo (with PDF/PNG support), Pango >= 1.44, and
pkg-config. The locked gtk-rs 0.22 dependencies require Rust >= 1.92.

```sh
# macOS
brew install cairo pango pkgconf
cargo build --release --locked -p canvas-cairo-replay
src-tauri/target/release/canvas-cairo-pdf commands.json new-output.pdf

# Debian/Ubuntu native dependencies
sudo apt-get install libcairo2-dev libpango1.0-dev pkg-config
```

If Homebrew's tools are not on PATH, discover their locations at build time:

```sh
export PATH="$(brew --prefix pkgconf)/bin:$PATH"
export PKG_CONFIG_PATH="$(brew --prefix)/lib/pkgconfig:$(brew --prefix)/share/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
cargo build --release --locked -p canvas-cairo-replay
```

Windows requires native libraries matching the Rust target/toolchain, plus
pkg-config discovery; for example MSYS2 UCRT64 Cairo/Pango/pkgconf with the
`x86_64-pc-windows-gnu` Rust target. Supply toolchain paths via the environment,
not repository configuration. This implementation uses portable gtk-rs crates;
The renderer is independent of Tauri and can be tested with `cargo test -p canvas-cairo-replay`.
Distribution still requires target-specific validation. Cross-compiling alone
does not supply the target's native libraries or fonts.

The binary dynamically links native dependencies. Distributing it requires the
corresponding target libraries and their licenses; a local release build is not
a self-contained distributable. No fonts are bundled. Rust dependencies include
MIT/Apache-2.0 packages and gtk-rs' MIT packages; Cairo and Pango have separate
native-library licenses that must be included by the packaging layer.

## Rust API

```rust,no_run
use canvas_cairo_replay::{render_file, RenderOptions};

let report = render_file("commands.json", "new-output.pdf", &RenderOptions::default())?;
assert!(report.pages > 0);
# Ok::<(), anyhow::Error>(())
```

`render_input(protocol::Input, output, &options)` accepts decoded/constructed
recordings or manifests and revalidates them. Both entrypoints exclusively
create a new `.pdf` file (case insensitive extension); they never overwrite an
existing path, including dangling symlinks. On a rendering/read/write failure,
all native handles close before the partial PDF is removed. A cleanup failure
is reported with the original rendering error. Process termination or power
loss is outside this error-cleanup guarantee. Output is not atomically published:
callers must wait for successful return before consuming it.

The library returns font diagnostics and never writes document text to logs.
Options are explicit and do not read the process environment. The CLI supports:

- `PLIFLO_FONT_ALIASES`: path to a JSON object mapping family names to nonempty
  family names. With no aliases, the original family list spacing is retained:
  normalizing commas/spaces can alter Pango/CoreText fallback selection.
- `PLIFLO_FONT_DIAGNOSTICS`: presence enables deduplicated
  `FONT requested => actual` stderr lines, without document text.

CLI exit codes: `0` success, `2` usage/invalid or existing output path, `1`
protocol, input, native rendering or I/O failure. A concurrent creator is safely
rejected by `create_new` and may return `1` after initial CLI checks.

## Recording v1 contract

Input is either one recording or `{ "pages": [recording-or-path, ...] }`.
Manifest paths are relative to the process working directory,
**not** the manifest's parent. Path entries are read
one at a time; inline entries already reside in the input JSON. Each page has
its own `size.widthPt`/`size.heightPt`; the scale is `widthPt / width`.

Required recording fields: `version: 1`, `size`, `width`, `height`, `commands`,
`unsupported: []`. Optional metadata: `index`, `sourcePages`, `reference`.
Commands have `op`, fixed-arity `args`, and the recorder's complete `state`.
`save`/`restore` permit omitted state. Unknown fields and operations are rejected;
unsupported operations never silently disappear.

Supported operations: `save`, `restore`, `beginPath`, `closePath`, `rect`,
`moveTo`, `lineTo`, `clip`, `fill`, `stroke`, `fillRect`, `strokeRect`,
`clearRect`, `fillText`, and five-argument PNG `drawImage`.

Text retains px absolute sizing, numeric weights 1–1000, normal/bold/italic/
oblique styles, family fallback, alphabetic/top/middle/bottom baselines, and
left/start/right/center alignment. `maxWidth`, other baselines/alignments,
shadows, other composites, gradients and non-`#RRGGBB` drawing colors fail.
Rect shortcuts and text preserve the current path; fill/clip/stroke preserve it
too. Save/restore balance is checked per page, with a fresh context per page.

Validation limits (failures, never clamping): finite scalar geometry within
±1,000,000; positive page/canvas/image sizes; invertible finite transforms;
alpha in [0,1]; positive line width/miter and nonnegative, nonzero-total dashes;
font sizes in (0,16384]; PNG base64 <= 128 MiB and decoded pixels <= 64 million.
PNG dimensions must match their recording metadata. NUL text/family names are
rejected instead of being truncated by native string APIs.

## Verification

```sh
cargo test -p canvas-cairo-replay --locked
cargo clippy -p canvas-cairo-replay --all-targets --locked -- -D warnings
cargo fmt --all -- --check
```

Tests cover strict protocol validation, Rust-constructed nonfinite values,
stack balance, actual PDF page dimensions/text/images, all supported operations,
working-directory manifest resolution, late-page cleanup, malformed PNGs,
aliases/fallback diagnostics, no overwrite, symlinks and concurrent creators.
The PDF parser is a dev dependency only; production rendering uses Cairo/Pango.
PDF verification should use known input text and page dimensions, with visual
inspection where layout matters. Record the native library versions, installed
fonts and alias configuration when reporting rendering differences.
