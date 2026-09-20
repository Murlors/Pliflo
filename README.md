# Pliflo

<p align="center">
  <img src="src-tauri/icons/pliflo.svg" width="112" alt="Pliflo icon" />
</p>

<p align="center">
  A lightweight desktop workspace for batch-printing local documents with clear per-file control.
</p>

Pliflo is a local-first document batch printing app built with **Tauri 2 + React + TypeScript + Vite+**. It is designed for people who regularly print groups of PDFs, Office documents, Markdown files and images and want a faster workflow than opening and configuring every document one by one.

The first release targets **macOS**. The architecture keeps Windows support in mind, but Windows printing behavior has not been validated yet.

## What Pliflo does

- Import PDF, DOCX, PPTX, XLSX, Markdown and common images by file picker or drag and drop.
- Reorder a batch before printing.
- Preview the selected document inside the app using a unified printable representation.
- Apply settings to the whole batch or override an individual file.
- Control copies, page range, paper size, orientation, duplex, color mode, scaling, pages per sheet, reverse order and odd/even pages.
- Expose tray and print-quality controls only when the selected printer reports those capabilities.
- Submit each document as its own print job, so one document does not block configuration or cancellation of the rest of the batch.
- Track queued, submitted, printing, completed, cancelled and failed states separately.
- Keep lightweight local history and optionally restore an unfinished batch.
- Review each file's sides, tray, copies and page settings before submission. Batch changes apply to unsubmitted files and subsequent imports; submitted settings stay read-only.
- Remove files directly from the queue without deleting sources, or requeue failed/cancelled attempts individually and failed files together. Requeueing rebuilds printable artifacts and never automatically submits a new print job.
- Keep printer warnings visible and expand history to inspect submitted settings and system reasons. Older entries without a submission snapshot are explicitly identified.
- Switch between Chinese and English, with system/light/dark appearance modes.

Pliflo does not upload documents or require a server. Inspection, conversion, preview state and print orchestration stay on the local machine.

## Supported document formats

| Format                              | Local preparation strategy                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| PDF                                 | Used directly as the printable document                                                                              |
| DOCX                                | Parsed and paginated locally with `@silurus/ooxml`, then rendered to a temporary PDF                                 |
| PPTX                                | Slides rendered locally with `@silurus/ooxml`, preserving slide page size in the temporary PDF                       |
| XLSX                                | Worksheets rendered locally with `@silurus/ooxml`; Pliflo provides sheet selection plus fit-width or 100% pagination |
| Markdown                            | Parsed locally with `marked` and rendered with Pliflo's lightweight paged print style                                |
| PNG / JPG / JPEG / WebP / GIF / BMP | Rendered locally to paper-sized pages with fit-page or actual-size behavior                                          |

Non-PDF sources converge on the same model: **source file → WebView layout → Canvas recording → Rust Cairo/Pango → temporary PDF → preview/settings/queue/CUPS**. The local `@pliflo/canvas-recorder` and `canvas-cairo-replay` workspace libraries preserve supported text and vectors. Pages and embedded PNG assets travel through binary IPC and are spooled under the system-temp render directory. Documents are prepared one at a time; superseded/cancelled results are discarded and persisted batches rebuild from their original sources. Native cancellation is checked between pages. Complex drawing operations outside the renderer's supported Canvas subset fail visibly rather than silently dropping content.

XLSX printing is intentionally pragmatic rather than an Excel-compatible print engine: it uses the worksheet used range, supports visible-sheet selection, fit-width and 100% scaling, and paginates vertically. Excel-specific print areas, repeating print titles and every page-layout feature are not currently reproduced. Image “actual size” uses 96 DPI when reliable physical-density metadata is unavailable.

## Printing model

On macOS, Pliflo submits through CUPS commands and reads structured printer/job status through the system libcups library. Printer capabilities are discovered from the device before printer-specific controls are shown. Queue waiting, held/stopped, processing, cancelled, aborted and system-completed jobs are distinguished. System completion is not independent confirmation of physical output. Local CUPS reports may be cached; generic paper-empty reports do not identify a tray and are displayed as such. A failed status query retains the last report with a visible unavailable-state notice.

There is an intentional distinction between **job submitted** and **printing completed**. A successful submission only means macOS accepted the job; completion is shown after the operating system reports that the job has finished.

During development, do not use the print action for routine testing. The UI, build and printer-discovery paths can be validated without sending a real print job.

## Tech stack

| Area               | Choice                             |
| ------------------ | ---------------------------------- |
| Desktop shell      | Tauri 2                            |
| UI                 | React 19 + TypeScript              |
| Frontend toolchain | Vite+                              |
| Package manager    | Bun                                |
| Icons              | Lucide React                       |
| Office rendering   | `@silurus/ooxml`                   |
| Markdown parsing   | `marked`                           |
| Native layer       | Rust                               |
| macOS printing     | CUPS / `lp`, `lpstat`, `lpoptions` |
| Persistence        | Local storage                      |

The project intentionally avoids a backend, database and heavyweight UI framework to keep the app small and maintenance straightforward.

Office preparation uses main-thread Canvas recording. The Vite configuration
excludes the three unused OOXML 0.87.0 render-worker entrypoints; parser workers
and WASM remain available. Review these version-specific aliases when upgrading
OOXML. The recorder emits binary PNG assets only. Release builds strip native
symbols; PDF inspection retains parallel parsing without optional date adapters.

XLSX geometry and Markdown parsing load only when preparing those formats, so
opening the application does not preload their rendering dependencies.

Dependency ownership follows the rendering boundary:

- Pliflo owns OOXML, Markdown, React and the Tauri bridge. The Canvas recorder
  has no runtime dependencies and does not install a second OOXML engine.
- The Rust replay library owns Cairo/Pango and command decoding. Pliflo owns
  PDF inspection through `lopdf`; replay tests share that workspace dependency.
- `vite` is an alias of the same Vite Plus core used by `vite-plus`, not another
  bundled engine. UnoCSS, TypeScript and browser regression tools are development
  dependencies; their transitive packages are not shipped as a Node runtime.
- Cargo can resolve different versions for build tools and runtime code. For
  example, Tauri's icon code generation and menu library use different PNG
  versions. Do not force transitive versions together without checking their
  consumers and compatibility.
- Native packaging follows actual dynamic-library links and deduplicates source
  paths. Homebrew Cairo's X11 dependencies are part of that linked graph, even on
  macOS; deleting them requires changing the native build, not removing files
  from the app bundle.

Inspect JavaScript resolution with `bun pm ls --all`, Rust consumers with
`cargo tree --workspace --duplicates` and `cargo tree --invert <package>`, and
packaged native sizes with the generated native bundle manifest. Lockfile entry
counts and local dependency-cache sizes are not application bundle sizes.

## Development

Requirements:

- macOS for the currently supported native printing path
- Rust 1.92+ toolchain (required by the Cairo/Pango Rust bindings)
- Cairo/Pango and pkg-config (`brew install pkgconf cairo pango` on macOS)
- Bun 1.4+
- Tauri 2 system prerequisites

Install dependencies:

```bash
bun install
```

Run the desktop app:

```bash
bun run desktop:dev
```

Run frontend checks and build:

```bash
vp check
vp build
```

Build the macOS application and DMG:

```bash
bun run desktop:build
```

Use `bun run desktop:build --app-only` for a local `.app`, or `bun run desktop:build` for an app and DMG. The build script collects native dynamic libraries, strips local symbols from copies, rewrites their paths into the app's Frameworks directory and derives the minimum macOS version from the executable and libraries. Newer dependencies do not block packaging; the resulting app advertises their actual system requirement.

The dependency/size inventory is written to `src-tauri/target/native-bundle-manifest.json`; temporary packaging copies are removed after restoring the original executable. Native license notices, Homebrew source inventories and build recipes are included under the app's `Contents/Resources/third-party` directory. Bun/Node are build tools, not bundled runtimes. Use this command rather than bare `tauri build` to include the native libraries.

Rendering checks (no printing):

The rendering command builds only the workspace renderer CLI, without compiling
the desktop shell. It requires Chromium and Poppler as shown below.

```bash
bun run test:protocol
cargo test --workspace --locked
bunx --no-install playwright-core install chromium
# Requires Poppler; use synthetic or locally authorized documents.
bun run test:rendering /absolute/path/report.docx /absolute/path/slides.pptx /absolute/path/workbook.xlsx
# Optional Chromium CPU profiles, saved beside the generated PDFs:
PLIFLO_RENDER_PROFILE=1 bun run test:rendering /absolute/path/workbook.xlsx
```

The test transport sends page buffers as raw HTTP bodies intercepted by Playwright,
not arrays serialized through browser bindings. Reports separate renderer process
time (`nativeMs`) and recording payload size (`recordingBytes`) from total elapsed
time. These are local regression measurements, not packaged-app startup or native
Tauri IPC benchmarks; CPU profiling also adds measurement overhead.

The browser regression runs the actual preparation code with an IPC test transport and the Rust renderer; it does not replace a packaged WKWebView smoke test. The Bun and Cargo workspaces share root lockfiles; protocol changes are checked with both producer and renderer tests. OOXML and format-specific layout are application dependencies, not recorder dependencies. Native binary redistribution also requires the bundled libraries' license notices and source-access obligations; the current packaging manifest is an inventory, not a completed license audit.

## Project structure

```text
src/
  App.tsx            Application orchestration and state
  app/               Shared app types, defaults and localized copy
  components/        Queue, preview, print settings and drawers
  lib/               Document preparation, printing estimates and local persistence
  styles/            Tokens, globals and semantic component styles
src-tauri/
  src/lib.rs         Native file/PDF, printer and job-tracking commands
  icons/             Minimal desktop icon set + vector source
  tauri.conf.json    Window, security and bundle configuration
packages/canvas-recorder/  Dependency-free TypeScript recorder and protocol
crates/cairo-replay/       Rust Cairo/Pango renderer and CLI
compat/ooxml/             Version-checked worksheet geometry extension
scripts/                  Build, packaging and rendering verification
Cargo.toml                Rust workspace; output remains in src-tauri/target
AGENTS.md            Maintenance rules for future agents and contributors
PRODUCT.md           Product behavior and scope
DESIGN.md            Visual direction and interaction notes
```

## Documentation

- `README.md` is the public entry point for setup, architecture, platform status and releases.
- `PRODUCT.md` records durable product scope, behavior and constraints.
- `DESIGN.md` records the visual system and interaction rules.
- `AGENTS.md` records repository-level maintenance rules, including print safety, architecture boundaries, styling ownership and verification expectations.

## Releases

Tags matching `v*` trigger the GitHub Actions release workflow. Apple Silicon and Intel packages are built on separate native runners so each includes matching Cairo/Pango libraries. The workflow uploads architecture-specific app archives and DMGs. Validate both architectures and dependency licenses before tagging a release.

Builds use ad-hoc signing unless `APPLE_SIGNING_IDENTITY` is configured. Packaging verifies the complete app signature; ad-hoc signing is not Developer ID signing or notarization, so downloaded builds may still show Gatekeeper warnings.

## Asset policy

Pliflo keeps only assets that are used by the desktop build or act as a regeneration source. The canonical artwork is `src-tauri/icons/pliflo.svg`; platform-specific raster icons should be generated from it when a new target is actually added.

This avoids committing full iOS/Android icon matrices or duplicate template artwork to a desktop-only repository.

## Current platform status

**macOS** is the supported first-release target and the only native printing path currently implemented and checked in development.

**Windows** remains an intended extension target. The Windows icon is retained, but printer discovery, option mapping and job-status behavior still require a Windows-specific implementation and validation before Windows can be considered supported.

## License

No project-wide open-source license has been selected yet. The recorder and
renderer imported from canvas-cairo-pdf retain their MIT licenses in their
module directories. Related OOXML adapter/build code retains the notice in
`compat/ooxml/LICENSE`. Third-party dependencies retain their own licenses.
