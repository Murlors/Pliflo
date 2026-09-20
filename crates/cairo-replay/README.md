# Rust Cairo/Pango renderer

`canvas-cairo-replay` exposes a Rust library (`canvas_cairo_replay`) and the
`canvas-cairo-pdf` binary. It renders Canvas recording v1 to PDF;
it does not lay out Office documents or submit print jobs.

## Build and run

Install Rust and native Cairo (with PDF/PNG/FreeType support), Pango >= 1.56
(including its FreeType/Fontconfig backend), and
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
System fonts are selected through the platform font map, then rendered through
a private FreeType font map, preserving the selected family for each text run.
This keeps platform fallback while avoiding CoreText PDF variable-font and
ligature mapping differences. Text remains embedded text/vector content.
Document fonts are loaded into this private map, using their OpenType family
names and document aliases. Font files and caches live beside the output in a
temporary directory and are removed when rendering ends. The macOS map uses
font files enumerated by CoreText and self-contained synthetic-style rules;
it does not require Homebrew's font configuration on the receiving machine.
The macOS system font catalog is initialized once per process; restart after
installing or removing system fonts. Embedded fonts remain private to each PDF.
Browser/native metric equality and complete Office fidelity are not guaranteed;
known text, actual selected fonts and visual output must all be checked.
Options are explicit and do not read the process environment. The CLI supports:

- `PLIFLO_FONT_ALIASES`: path to a JSON object mapping family names to nonempty
  family names. CSS family-list separators are normalized before calling Pango,
  with or without aliases; surrounding single/double quotes are removed while
  spaces within family names are preserved. This prevents separator whitespace
  from breaking native fallback matching. Quoted names containing commas and
  CSS escape sequences are not supported.
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
Binary pages use CCP1 (JSON and PNG payloads) or CCP2 (the same layout followed
by a font count and length-prefixed raw OpenType payloads). Integers are u32
little-endian. CCP2 JSON includes `fonts: [{family, weight, style}]` in payload
order; style is `normal` or `italic`. Font bytes cannot be supplied through JSON.
Fonts remain available on subsequent pages of the same PDF. Send each face once;
duplicate document family/style/weight bindings are rejected. Limits are 64
faces and 64 MiB of font bytes per document, within the 256 MiB binary-page limit.
Commands have `op`, fixed-arity `args`, and the recorder's complete `state`.
`save`/`restore` permit omitted state. Unknown fields and operations are rejected;
unsupported operations never silently disappear.

Supported operations: `save`, `restore`, `beginPath`, `closePath`, `rect`,
`moveTo`, `lineTo`, `clip`, `fill`, `stroke`, `fillRect`, `strokeRect`,
`clearRect`, `fillText`, and five-argument PNG `drawImage`.

Text retains px absolute sizing, numeric weights 1–1000, normal/bold/italic/
oblique styles, family fallback, alphabetic/top/middle/bottom baselines, and
left/start/end/right/center alignment. Optional `direction` is `ltr` (default)
or `rtl`; it controls shaping and start/end alignment. `maxWidth`, other baselines,
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
Font tests cover binary truncation, same-name session isolation, cross-page
reuse, Unicode extraction, and temporary-resource cleanup using original tiny
test fonts. They do not require proprietary Office fonts.
The PDF parser is a dev dependency only; production rendering uses Cairo/Pango.
PDF verification should use known input text and page dimensions, with visual
inspection where layout matters. Record the native library versions, installed
fonts and alias configuration when reporting rendering differences.
