# Pliflo

<p align="center">
  <img src="src-tauri/icons/pliflo.svg" width="112" alt="Pliflo icon" />
</p>

<p align="center">
  A lightweight desktop workspace for batch-printing PDFs with clear per-file control.
</p>

Pliflo is a local-first PDF batch printing app built with **Tauri 2 + React + TypeScript + Vite+**. It is designed for people who regularly print groups of PDFs and want a faster workflow than opening and configuring every document one by one.

The first release targets **macOS**. The architecture keeps Windows support in mind, but Windows printing behavior has not been validated yet.

## What Pliflo does

- Import multiple PDFs by file picker or drag and drop.
- Reorder a batch before printing.
- Preview the selected PDF inside the app.
- Apply settings to the whole batch or override an individual file.
- Control copies, page range, paper size, orientation, duplex, color mode, scaling, pages per sheet, reverse order and odd/even pages.
- Expose tray and print-quality controls only when the selected printer reports those capabilities.
- Submit each PDF as its own print job, so one document does not block configuration or cancellation of the rest of the batch.
- Track queued, submitted, printing, completed, cancelled and failed states separately.
- Keep lightweight local history and optionally restore an unfinished batch.
- Switch between Chinese and English, with system/light/dark appearance modes.

Pliflo does not upload documents or require a server. PDF inspection, preview state and print orchestration stay on the local machine.

## Printing model

On macOS, Pliflo talks to the system printing stack through CUPS commands. Printer capabilities are discovered from the device before printer-specific controls are shown.

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
| Native layer       | Rust                               |
| macOS printing     | CUPS / `lp`, `lpstat`, `lpoptions` |
| Persistence        | Local storage                      |

The project intentionally avoids a backend, database and heavyweight UI framework to keep the app small and maintenance straightforward.

## Development

Requirements:

- macOS for the currently supported native printing path
- Rust toolchain
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

## Project structure

```text
src/
  App.tsx            Application orchestration and state
  app/               Shared app types, defaults and localized copy
  components/        Queue, preview, print settings and drawers
  lib/               Printing estimates and local persistence
  styles/            Tokens, globals and semantic component styles
src-tauri/
  src/lib.rs         Native PDF/printer commands and job tracking
  icons/             Minimal desktop icon set + vector source
  tauri.conf.json    Window, security and bundle configuration
PRODUCT.md           Product behavior and scope
DESIGN.md            Visual direction and interaction notes
```

## Releases

Tags matching `v*` trigger the GitHub Actions release workflow. The workflow builds a universal macOS bundle for Apple Silicon and Intel, then publishes the generated app/DMG assets to a GitHub Release.

The first public build is unsigned and not notarized unless Apple signing credentials are configured in CI. macOS may therefore show the standard Gatekeeper warning for downloaded builds.

## Asset policy

Pliflo keeps only assets that are used by the desktop build or act as a regeneration source. The canonical artwork is `src-tauri/icons/pliflo.svg`; platform-specific raster icons should be generated from it when a new target is actually added.

This avoids committing full iOS/Android icon matrices or duplicate template artwork to a desktop-only repository.

## Current platform status

**macOS** is the supported first-release target and the only native printing path currently implemented and checked in development.

**Windows** remains an intended extension target. The Windows icon is retained, but printer discovery, option mapping and job-status behavior still require a Windows-specific implementation and validation before Windows can be considered supported.

## License

No open-source license has been selected yet.
