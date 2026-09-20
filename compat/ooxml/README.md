# OOXML worksheet geometry adapter

The pinned @silurus/ooxml 0.87.0 package does not expose the worksheet geometry required for fit-to-page calculations. This build-time extension reuses its renderer's font metrics, column ranges and pixel rounding instead of duplicating the algorithm.

`scripts/prepare-ooxml.ts` verifies the upstream version and module SHA-256, copies the runtime and license notices to `node_modules/.cache/pliflo-ooxml`, and appends this extension. It does not modify the installed package or rewrite modules during HTTP requests.

Consumers use `worksheetRenderWidth(sheet, columns, scale)` from the generated `xlsx-print-geometry.mjs`. The result includes the row header. Internal upstream symbols are confined to this directory.

When changing the pinned dependency, review this extension and its hash, then run `vp run build` and `vp run test:rendering` with a wide XLSX fixture, checking that its last column remains present. This is a project-maintained adapter, not an upstream public API. Keep the .js format and exclude it from standalone formatting/linting because the fragment references the upstream module's internal symbols.
