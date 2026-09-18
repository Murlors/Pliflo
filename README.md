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

Non-PDF sources converge on the same model: **source file → local preparation → temporary printable PDF → existing preview/settings/queue/CUPS path**. Imported files appear in the batch as soon as metadata inspection finishes; generated documents are then prepared one at a time, with lossless PNG pages transferred through Tauri binary IPC and spooled into Pliflo's system-temp directory instead of retained as a full-document frontend buffer. Superseded or cancelled preparation is discarded and cleaned up, and persisted unfinished batches rebuild temporary artifacts from the original source.

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
  lib/               Document preparation, printing estimates and local persistence
  styles/            Tokens, globals and semantic component styles
src-tauri/
  src/lib.rs         Native file/PDF, printer and job-tracking commands
  icons/             Minimal desktop icon set + vector source
  tauri.conf.json    Window, security and bundle configuration
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
