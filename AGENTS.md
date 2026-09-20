# Pliflo Agent Guide

This file defines the project-level rules for future coding agents and maintainers. Keep it focused on durable product, architecture and verification constraints; implementation details belong in code, `README.md`, `PRODUCT.md` or `DESIGN.md`.

## Product and platform

- Pliflo is a local-first desktop utility for batch-printing PDF, DOCX, PPTX, XLSX, Markdown and common image files.
- The supported first-release platform is macOS.
- The current native print backend uses the macOS/CUPS toolchain (`lp`, `lpstat`, `lpoptions`).
- Windows remains an extension target. Do not treat the current CUPS implementation as portable; Windows support needs a platform-specific backend and real validation.
- Files stay on-device. Avoid introducing a server, database, telemetry service or cloud dependency unless the product scope explicitly changes.
- Small package size, fast startup, low maintenance cost and modest dependency count are product constraints, not optional optimizations.

## Printing safety and semantics

- Never submit a real print job during development, testing or automated verification unless the user explicitly authorizes it for that run.
- Read-only printer discovery and capability inspection are safe default checks.
- Preserve the distinction between a source document in the batch, a locally prepared printable artifact, a job accepted by the operating system, an actively printing job and a physically completed job.
- A successful submission must not be reported as printing completion.
- Every successfully prepared document is submitted as an independent print job by default.
- Cancellation, failure and incomplete states must remain observable rather than being silently converted to success.
- Show printer-specific controls only when the selected printer or driver actually reports that capability. Do not invent unsupported paper trays, quality levels, duplex modes or color modes for UI completeness.

## Source boundaries

Keep the frontend structure shallow and easy to navigate:

```text
src/
  App.tsx         Application orchestration and high-level state
  app/            Shared app types, defaults and localized copy
  components/     UI regions and reusable desktop controls
  hooks/          Focused React hooks when stateful behavior is reusable
  lib/            Document preparation, printing estimates, persistence and other helpers
  styles/         Theme tokens, globals and semantic/complex CSS
src-tauri/
  src/lib.rs      Native file/PDF, printer and job-tracking commands
```

- Keep `App.tsx` as the orchestration shell instead of moving the whole product into one component or creating a deep feature hierarchy.
- Prefer existing components, types and helpers before adding another abstraction layer.
- Add dependencies only when they materially reduce implementation risk or maintenance cost.
- Platform-specific native printing logic belongs behind explicit platform boundaries rather than scattered through React components.

## Document preparation model

- Keep the original local source path as the durable document identity. `printPath` is the current printable representation used by preview and submission.
- PDF sources use the original file directly. DOCX, PPTX, XLSX, Markdown and images are prepared locally into temporary PDFs before reusing the shared settings, estimates, queue and CUPS path.
- Prefer `@silurus/ooxml` for OOXML parsing/rendering where its API provides the needed layout data. Do not imply unsupported Office fidelity: XLSX pagination is Pliflo's used-range/scale model rather than a complete Excel print engine.
- Use the local `@pliflo/canvas-recorder` Bun workspace and `canvas-cairo-replay` Cargo workspace for PDF output. Recording/protocol belongs in `packages/canvas-recorder`; native decoding, fonts and replay belong in `crates/cairo-replay`. Keep protocol changes and their tests together. Pliflo owns OOXML/document layout, Tauri IPC, session cleanup and product lifecycle. Do not add OOXML dependencies to the generic recorder or renderer.
- Install from the repository root using `bun.lock` and the root `Cargo.lock`. Cargo output stays in `src-tauri/target` through `.cargo/config.toml`. Do not introduce nested lockfiles or sibling-checkout dependencies. Preserve the imported modules' MIT notices.
- Record only canvases owned by document preparation. Send CCP1 binary pages (raw PNG assets) or CCP2 pages (additional raw document fonts), and reject unsupported operations explicitly. Document font extraction belongs to the format adapter; font resources must stay session-local, bounded and cleaned up, never installed globally. Keep bundled WASM loading permitted by narrowly scoped CSP entries (`self` and `wasm-unsafe-eval`).
- Generated artifacts belong only under Pliflo's system-temp render root. Remove superseded artifacts when safe, rebuild them from the source after restoring a persisted unfinished batch, and never delete or modify original user files.
- Keep preparation asynchronous and bounded so importing many files does not create unbounded concurrent WASM/render work or memory use. Generated pages should be transferred as raw binary data and spooled incrementally to the temp render session rather than retained for the whole document in frontend memory or serialized through Base64.
- Preparation invalidated by file removal or format-specific option changes should stop cooperatively when possible; stale results must never replace newer settings or resurrect a removed queue item.
- A corrupted, encrypted or otherwise unreadable source must remain visible as a failed document without aborting preparation of the rest of the batch.
- Format-specific settings should be incremental additions to the existing settings panel and appear only for formats that support them.

## UnoCSS and CSS ownership

- Use UnoCSS utilities for ordinary layout, spacing, sizing, alignment, responsive behavior and typography.
- Keep CSS for theme variables, light/dark mappings, borders and shadows, interaction/state styling, complex controls, scrollbars, reduced-motion rules and a small number of semantic component styles.
- Avoid moving simple utility-shaped declarations back into large component CSS blocks.
- Avoid hard-coded one-off colors in JSX when an existing theme token expresses the same meaning.
- New UI work must preserve both light and dark themes; check hover, focus, disabled, selected, warning, error and primary-action states in both modes.

## UI and interaction rules

- Use Lucide for interface icons. Do not use emoji as UI icons or status markers.
- Keep controls compact enough for a daily desktop utility while preserving readable type and clear hit targets.
- Favor restrained rounding and consistent control geometry; avoid sharp visual seams or excessive nested containers.
- Keep the preview visually dominant and avoid turning the workspace into a generic card dashboard.
- Do not add decorative effects that meaningfully increase bundle size, rendering cost or interaction friction.
- Respect `prefers-reduced-motion` for non-essential motion.

## Internationalization

- Current UI languages are Simplified Chinese and English.
- Store user-facing copy in `src/app/i18n.ts` instead of hard-coding new strings inside components.
- Structure new copy so additional languages can be added without rewriting component logic.
- Keep product names, printer-reported values and other machine-provided strings separate from translated interface copy.

## Verification

Prefer `vp run <task>` for project scripts in `package.json`, including desktop tasks. If `vp` is unavailable on PATH, use `bun x --no-install vp run <task>`. Keep Bun for dependency installation and script runtime; do not bypass the native packaging script.

For routine frontend/documentation changes, use the smallest relevant checks. Before a release or after native printing changes, use the broader set.

```bash
vp run check
vp run build
vp run check:native
git diff --check
```

For desktop packaging when needed:

```bash
vp run desktop:build
```

Do not use the print button or invoke the submission command as a smoke test. Verify printer discovery, capability mapping, UI state and build output without creating real jobs unless explicit authorization is present.

## Documentation responsibilities

- `README.md`: public project overview, setup, commands, structure, release and platform status.
- `README.zh-CN.md`: Chinese public guide; keep setup, commands, platform support and limitations aligned with the English README.
- `CONTRIBUTING.md`: contributor workflow, local checks and release procedure.
- `LICENSE` / `THIRD_PARTY_NOTICES.md`: project MIT license and third-party attribution; preserve module-level copyright notices and include project notices in packaged apps.
- `PRODUCT.md`: durable product scope, users, behavior and product constraints.
- `DESIGN.md`: visual system, interaction principles and design implementation boundaries.
- `AGENTS.md`: repository operating rules for future agents and maintainers.

Update the relevant documents when behavior or architecture changes. Keep agent guidance in English and link to detailed documentation rather than duplicating it.

## Commits and releases

- Keep unrelated working-tree changes untouched.
- Prefer focused commits and Chinese Conventional Commit messages that describe the actual diff.
- Write public release titles, release notes and annotated tag messages in English. Commit messages remain Chinese Conventional Commits.
- Use `vp run desktop:build` for packaging: it closes the native dylib dependency graph and derives the minimum macOS version from the executable and libraries. Do not impose a fixed-version packaging gate or require an override for newer local dependencies. Report the actual minimum OS without claiming unverified older-system compatibility. Bare `tauri build` does not include the native packaging step.
- Tags matching `v*` trigger `.github/workflows/release.yml`, which builds separate Apple Silicon and Intel packages with matching native dependencies and publishes a GitHub Release.
- Keep automatic CI limited to release builds. Run routine checks locally; do not add branch/PR check workflows or background cache-warming jobs without an explicit request.
- Do not rewrite an already published release tag just to include later documentation changes. Use a new version/tag when a new release is intended.
