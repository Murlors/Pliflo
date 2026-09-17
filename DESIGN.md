# Pliflo Design System

## Direction

Pliflo uses a **Mastering Console** visual metaphor. A print batch is treated like a controlled signal chain: source PDFs enter on the left, the active sheet is inspected on a paper stage in the center, output is tuned on the right, and job state stays visible in the transport strip above.

The interface is an operational desktop tool first. Visual character should reinforce hierarchy, state and precision without adding friction or decorative weight.

## Visual World

- Chrome: dark graphite instrument surfaces rather than generic app panels.
- Preview: warm paper-white stage with restrained borders and shadows.
- Accent: a single phosphor green for readiness, active selection and primary actions.
- Secondary status: amber for active work, muted green for completed work, warm red for destructive/error states.
- Shape language: compact rectangular controls, etched rules, minimal rounding.
- Texture: rely on contrast, rules and subtle inset depth. Avoid decorative grids, gradients or large ornamental effects.

## Core Tokens

The canonical runtime tokens live in `src/App.css` under `.app-shell`.

- Console: `#171a18`, `#1d211e`, `#252a26`
- Console text: `#edf0e8`
- Muted console text: `#8e978d`
- Paper: `#f3f3ec`, `#e8e9e1`
- Ink: `#20241f`
- Accent: `#b8ed50`
- Accent strong: `#9fd532`
- Warning: `#e9bf69`
- Danger: `#e07b6d`

Use spacing and border contrast before adding new colors.

## Layout

The main workspace has three persistent regions:

1. **Document rail** — compact queue management, search, import and per-file status.
2. **Paper stage** — dominant preview area with minimal controls around the document itself.
3. **Output console** — printer selection, batch/file scope, print parameters, presets and the primary submission action.

The top transport shows Ready, Active and Done counts. The primary print action remains anchored to the lower-right output area. At narrower supported desktop widths, the transport may disappear before compromising the three working regions.

## Typography

Use the native/system sans-serif stack for low runtime cost and platform fit. Hierarchy comes from size, weight, tracking and case rather than multiple font families.

- Product and section titles: compact, medium-to-bold weight.
- Instrument labels and captions: small, high-tracking text.
- Counts and machine state: tabular numerals where values are compared.
- Avoid oversized display type inside the operational workspace.

## Controls and Icons

- Lucide is the only icon set.
- No emoji.
- Icon-only buttons require accessible labels.
- Native form controls should be visually integrated with explicit foreground/background colors.
- Hover and focus states increase contrast; keyboard focus remains visible.
- Frequent actions stay compact. Primary submission gets the strongest visual weight.

## Motion

Motion is restrained and functional. Prefer short opacity/transform transitions for state changes. Respect `prefers-reduced-motion`; do not use continuous ambient animation.

## macOS Window Treatment

The macOS release uses an overlay title bar with the native traffic lights above the dark console chrome. The application title is hidden so the product header provides the visual identity while native window controls remain familiar.

## Product-State Rules

- A PDF entering the batch is not yet a print job.
- `submitted` means the operating system accepted the job.
- `printing` and `completed` are distinct from submission and should never be implied prematurely.
- Failures and cancellation must remain visible and recoverable in history.
- Printer-dependent capabilities must reflect what the local device/driver reports.

## Design Guardrails

- Keep the center preview visually dominant.
- Do not turn the app into a generic card dashboard.
- Do not add visual decoration that competes with queue, preview or output controls.
- Preserve compact density; this is a daily-use desktop utility.
- Prefer local/native capabilities and lightweight implementation choices when visual alternatives are equivalent.
