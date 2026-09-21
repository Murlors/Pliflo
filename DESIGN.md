# Pliflo Design System

## Direction

Pliflo uses a **Mastering Console** visual metaphor. A print batch is treated like a controlled signal chain: source documents enter on the left, the active printable representation is inspected on a paper stage in the center, output is tuned on the right, and job state stays visible in the transport strip above.

The interface is an operational desktop tool first. Visual character should reinforce hierarchy, state and precision without adding friction or decorative weight.

## Visual World

- Chrome: dark graphite instrument surfaces rather than generic app panels.
- Preview: warm paper-white stage with restrained borders and shadows.
- Accent: a single phosphor green for readiness, active selection and primary actions.
- Secondary status: amber for active work, muted green for completed work, warm red for destructive/error states.
- Shape language: compact controls with restrained, consistent corner radii; avoid both harsh seams and inflated card-like rounding.
- Texture: rely on contrast, rules and subtle inset depth. Avoid decorative grids, gradients or large ornamental effects.

## Core Tokens

The canonical runtime theme tokens live under `src/styles/`, with semantic application styling in `src/styles/app.css`.

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

## Styling Ownership

- UnoCSS owns ordinary layout, spacing, sizing, alignment, responsive behavior and typography.
- Theme variables, light/dark mappings, borders and shadows, state styles, complex controls and a small set of semantic component styles stay in `src/styles/`.
- Prefer utility classes when a rule is structural and local to one component. Prefer CSS when the rule expresses shared theme/state behavior or would be awkward and repetitive as utilities.
- Every new visual state must remain legible in both light and dark appearance modes.

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
- Dropdown choices use the shared `Select` component, with themed menus, selected marks, keyboard navigation, type-ahead, Escape dismissal and visible focus. Menus open outside scrolling panels and stay inside the viewport. Driver capability checks and disabled fieldsets still govern availability.
- Other native form controls should be visually integrated with explicit foreground/background colors.
- Hover and focus states increase contrast; keyboard focus remains visible.
- Frequent actions stay compact. Primary submission gets the strongest visual weight.
- Light and dark themes must preserve the same hierarchy, capability states and action emphasis rather than simply inverting colors.

## Motion

Motion is restrained and functional. Prefer short opacity/transform transitions for state changes. Respect `prefers-reduced-motion`; do not use continuous ambient animation.

## macOS Window Treatment

The macOS release uses an overlay title bar with the native traffic lights above the dark console chrome. The application title is hidden so the product header provides the visual identity while native window controls remain familiar.

## Product-State Rules

- A source document entering the batch is not yet a print job.
- Non-PDF formats are prepared locally into a temporary printable PDF so preview, print settings, estimates and queue behavior remain visually and operationally consistent.
- Large or complex files should enter the queue immediately with a visible preparation state. They become printable only after the local artifact is ready; preparation progress must not be presented as print progress.
- Format-specific controls stay inside the existing settings flow and appear only when relevant. XLSX exposes sheet/scaling choices; images expose sizing choices. Do not add persistent format toolbars or additional workspace columns.
- Preparation failures stay visible as document-level error states without blocking already prepared documents in the batch.
- `submitted` means the operating system accepted the job.
- `printing` and `completed` are distinct from submission and should never be implied prematurely.
- Failures and cancellation must remain visible and recoverable in history.
- Queue rows expose removal and requeue actions directly. Requeue creates a fresh attempt; history stays intact. The submission review lists effective per-file settings before confirmation.
- Settings explicitly identify current-file versus batch scope. Submitted settings are read-only. Persistent printer reports and history details retain system reasons without inventing tray-specific status.
- Printer-dependent capabilities must reflect what the local device/driver reports.

## Design Guardrails

- Keep the center preview visually dominant.
- Do not turn the app into a generic card dashboard.
- Do not add visual decoration that competes with queue, preview or output controls.
- Preserve compact density; this is a daily-use desktop utility.
- Prefer local/native capabilities and lightweight implementation choices when visual alternatives are equivalent.
