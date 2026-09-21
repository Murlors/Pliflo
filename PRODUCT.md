# Product

<!-- impeccable:product-schema 1 -->

## Platform

Desktop application. macOS is the supported first-release platform; Windows is a planned extension target that requires its own printing backend and validation.

Windows 11 x64 adaptation has MSVC packaging, a private Windows font catalog,
PDFium/GDI submission and spooler tracking/cancellation. Installer and self-extracting
portable EXE builds are available. Initial Microsoft Print to PDF submission, tracking
and cancellation are validated; physical printers still need authorized validation; see [WINDOWS.md](WINDOWS.md). Disappearing jobs without a
completion report remain unconfirmed and are not automatically retried.

## Stack

Tauri 2 desktop application with React, TypeScript and Vite+. macOS is the complete first-release target; the architecture keeps room for a Windows print backend later. All files stay local and there is no server.

## Primary Users

People who repeatedly print groups of mixed local documents from a desktop Mac and need more control and visibility than opening each source application and system print dialog separately provides.

## Core Job

Import a mixed batch of supported local documents, put them in the intended order, inspect their printable form, choose batch defaults or per-file overrides, submit each document as an independent print job, and understand whether each job is merely submitted to the operating system or has actually completed.

## Operating Context

The product is a focused desktop utility used during routine document handling. Typical work happens with a printer already configured in macOS, several local PDFs, Office files, Markdown notes or images, and a need to prepare or monitor many jobs without repeatedly reopening source applications and native dialogs.

## Capabilities and Constraints

- Batch import through file picker and drag and drop for PDF, DOCX, PPTX, XLSX, Markdown and common image formats.
- Reorder, search, inspect metadata and preview the locally prepared printable document.
- Batch defaults plus per-file print settings.
- DOCX and PPTX use local `@silurus/ooxml` layout/rendering and become temporary printable PDFs before entering the shared print path.
- XLSX supports visible-sheet selection and pragmatic used-range pagination with fit-width or 100% scaling. It does not promise complete Excel print-area/page-layout fidelity.
- Markdown uses a lightweight local paged renderer. Remote Markdown images are not fetched; local relative images may be embedded during preparation.
- Images support fit-page and actual-size preparation; actual size assumes 96 DPI when physical-density metadata is unavailable.
- Generated printable artifacts are ephemeral, stay under Pliflo-owned system-temp storage, and are regenerated from the source after an unfinished batch is restored.
- Imported files become visible before expensive rendering completes. Local preparation is bounded, page output is spooled incrementally, and obsolete preparation is cancellable so large files do not monopolize frontend memory or keep stale work running unnecessarily.
- Printer discovery, presets, queue management, cancellation, history and explicit error states.
- Every document is submitted as its own system print job by default after local preparation succeeds.
- macOS submission uses the local CUPS command-line interface; structured status uses system libcups without adding a runtime dependency.
- Submission requires a per-file review of effective settings. Failed/cancelled attempts can be requeued with a new identity while preserving history; requeueing does not print automatically. Removing a batch entry never deletes its source.
- Printer warnings stay visible, including generic paper-empty reports when a tray cannot be identified. History preserves submission snapshots and system reasons; system completion does not independently confirm physical output.
- System submission and physical completion are separate states in the product model.
- Real printing must never be triggered during development or automated verification without the user’s explicit confirmation.
- Device-specific options are limited by the actual printer and driver capabilities available on the host.
- Small package size, low maintenance cost, fast startup and local-only processing are durable product constraints.

## Brand Commitments

The product name is Pliflo. The interface uses Lucide icons and never uses emoji. The user wants a distinctive, premium desktop-tool identity with the craft level associated with Awwwards and FWA work, while preserving speed, readability and day-to-day operational efficiency.

## Evidence on Hand

The current repository contains a macOS-first implementation with multi-format import, local Cairo/Pango PDF preparation, PDF-based preview/print normalization, settings, queue states, printer discovery, local persistence and Tauri packaging. Office layout runs in the system WebView; supported text and vectors remain searchable/vector content. Unsupported drawing fails visibly. Apple Silicon and Intel packages use architecture-matched native libraries, whose build versions determine minimum OS compatibility. There are no customer testimonials, benchmark claims or external brand assets to fabricate.

## Product Principles

- Make batch printing feel calm, legible and controlled even when many files are involved.
- Show operational truth precisely, especially the difference between job submission and physical completion.
- Keep the app lightweight by using mature platform capabilities instead of large runtime dependencies.
- Make frequent actions fast while keeping exceptions and per-file overrides easy to reach.
- Use visual character to make the tool memorable without reducing scanability or increasing friction.
