# Windows implementation and validation

Windows 11 x64 is an experimental preview target. macOS remains the supported platform.
Release v1.3.0 distributes the Windows preview alongside the macOS packages.
The PDFium/GDI backend has passed an initial authorized Microsoft Print to PDF test; physical printer output is not yet validated. Compilation, app startup,
document conversion, discovery, spooler acceptance and physical output are separate
acceptance gates. Do not infer one from another. No real or virtual printer may be
submitted to during automated checks.

## Native toolchain

Use Rust `x86_64-pc-windows-msvc` (1.92 or newer), Visual Studio 2022 C++ Build
Tools and Windows SDK, Bun 1.4.2, and MSVC x64 Cairo/Pango/FreeType/Fontconfig.
Do not link MSYS2 UCRT64/MinGW libraries into this application. MSYS2 can be a
build utility for gvsbuild; its runtime and compiler are not application dependencies.

The initial development baseline is [gvsbuild 2026.8.0](https://github.com/wingtk/gvsbuild/tree/2026.8.0),
whose Pango recipe builds 1.58.0 with FreeType and Fontconfig enabled. To rebuild
native dependencies from source, use that exact gvsbuild tag and its hashed source
recipes, and run `gvsbuild build --platform x64 --configuration release cairo pango`.
Record the Visual Studio and Windows SDK versions alongside the dependency manifest.
No GTK widgets are used by Pliflo.

For initial development, the upstream
[MSVC archive](https://github.com/wingtk/gvsbuild/releases/download/2026.8.0/GTK4_Gvsbuild_2026.8.0_x64.zip)
has SHA-256 `1f95a92d037f5292da05e6ab1037032ff21ddb7b20d4ac8e83e3674c864c07b0`.
Verify this digest before extracting. Experimental preview packages use this
verified upstream MSVC build; they are not builds of the native dependencies
from source on our release host. This is not a production support guarantee.
Rebuilding the pinned sources remains a gate before declaring Windows stable and
supported. The whole archive is never included in the installer.

Set `PLIFLO_NATIVE_PREFIX` to the extracted or built prefix containing `bin`,
`lib/pkgconfig` and `share/doc`. Add its `bin` to PATH, its `lib` to LIB and
`lib/pkgconfig` to PKG_CONFIG_PATH for local Cargo checks. Use a Visual Studio
x64 developer shell. `pkg-config --modversion pangoft2` must report 1.56 or newer.
Set `PLIFLO_VC_REDIST` to the licensed Visual Studio x64 Microsoft.VC143.CRT
redistributable directory when those DLLs are required by the native build.
Do not obtain runtime DLLs from arbitrary download sites.

Run from the repository root:

```text
bun install --frozen-lockfile
bun x --no-install vp run check
bun x --no-install vp run build
bun x --no-install vp run test:protocol
bun x --no-install vp run check:native
bun x --no-install vp run test:native
bun x --no-install vp run desktop:build
```

The platform packaging branch builds NSIS with app-local DLL resources. It walks
normal and delay-loaded PE imports, rejects incompatible image architectures and
MinGW runtime imports, and fails on unresolved libraries. The inventory includes
SHA-256 and size for each DLL and is saved in
`src-tauri/target/native-bundle-manifest.json`. Retained staging directories under
`src-tauri/target/windows-bundle-*` support inspection and isolated startup tests.
Installers go under `src-tauri/target/release/bundle/nsis/`.

NSIS reuses installed WebView2. When missing, `downloadBootstrapper` requires
internet access to install it. This installer is not a complete offline installer;
offline deployment must provision the Evergreen runtime separately. No full
browser runtime is bundled. Unsigned test builds are not signed releases and have
no asserted SmartScreen reputation. Do not disable Windows security to install them.

## Fonts and paths

Windows uses a private Pango/FreeType map populated from `%SystemRoot%/Fonts` and
the current user's `%LOCALAPPDATA%/Microsoft/Windows/Fonts`. Generic families map
to Windows fonts; embedded document faces stay session-local. The macOS CoreText
catalog and native-only-font behavior remain separate. Fonts registered from other
arbitrary directories are not yet enumerated. Missing language fonts can still
cause missing glyphs; no commercial fonts are bundled.

Binary page IPC sends an ASCII session identifier rather than the full temp path
in an HTTP header. Source paths and other session commands retain Unicode paths.
Original documents are never overwritten. Generated-artifact deletion is restricted
to direct render sessions and reports failures, including Windows sharing violations.
Both executables embed UTF-8 process manifests for native font loading under Chinese
paths. Embedded font paths of 260 UTF-16 units or longer fail explicitly: the tested
native stack can otherwise silently produce blank text. Use a shorter system temp
path. General long-source-path and sharing-violation coverage remains incomplete.

## Windows printing boundary

`windows_print.rs` owns discovery/capabilities; `windows_print/jobs.rs` owns GDI
submission, settings validation, job identities and spooler tracking/cancellation.
`windows_pdf.rs` is the narrow PDFium C interface. Blocking work runs off the UI
thread. PDFium calls are serialized; at most two application print workers may
exist (one rendering and one waiting). Closing while a worker is active is blocked
with a localized explanation. Each document has its own StartDoc job ID.

Settings are read and validated through DocumentProperties/DEVMODE before StartDoc.
Driver paper/tray IDs, orientation, copies/collation, duplex and color are mapped;
driver substitutions fail explicitly, except grayscale which PDFium also enforces
when a color driver declines monochrome DEVMODE. Page range and odd/even filters apply after
n-up grouping, matching the existing estimator; reverse order changes output sides.
PDFium fits pages into printable device bounds, or uses actual physical dimensions.
Mixed-size sources use the selected paper; automatic orientation uses the first
selected source page. Quality stays hidden because no generic quality mapping exists.
Copies requiring unsupported driver collation are rejected rather than silently
changing semantics. Interactive PDF forms must be flattened first; encrypted or
unreadable sources fail before a job is created. PDF input is file-backed, up to 4 GiB.

PDFium renders directly to the printer HDC; no RAW PDF or external viewer commands.
The spooler ID plus printer name and a unique document title identifies each job.
Queries/cancellation verify the title so a reused numeric ID cannot affect another job.
Cancellation requests use SetJob and cooperative worker checks; failures abort the
unfinished document. A request is not reported cancelled until deletion/absence is
observed and the worker has stopped. Drivers may block inside individual calls.

JOB_STATUS_COMPLETE only means sent to the device. Only JOB_STATUS_PRINTED reports
system completion; neither proves physical output independently. A missing job after
rendering becomes `unconfirmed`, remains in history, and is not automatically retried.
Transport/query errors retain the last known status. Closing/restarting cannot restore
unobserved terminal spooler events; such outcomes stay unconfirmed.

### Pinned PDFium build

Use [bblanchon/pdfium-binaries chromium/8057](https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium/8057),
`pdfium-win-x64.tgz` (155.0.8057.0), with V8/XFA disabled. This is a third-party
prebuilt PDFium distribution, not an official Google binary. The x64 C ABI and PE
dependency closure were checked; no MinGW runtime dependency is present.
Archive SHA-256: `e307d519e42f2e69b1b531f0c2a32dffcdf3891ec0eba60328ba51a57cec01ed`.
DLL SHA-256: `55e7ebef29a1ec9523d1adb8b260a73e7dfb0f64d3f0285121d20ecd6148ef18`.
Extract under `src-tauri/target/windows-tools/pdfium` or set `PLIFLO_PDFIUM_PREFIX`.
The packager verifies the DLL digest and includes all licenses, version and build args.
Updating PDFium requires consciously updating this pin and repeating rendering tests.
No PDFium JavaScript engine is included. PDFium adds 7,375,360 uncompressed DLL bytes.
Cairo continues generating PDFs; PDFium only reads/renders them for Windows printing.
Final driver output can rasterize and is not promised to preserve vectors.

### Portable EXE

`vp run desktop:build` produces both NSIS and
`src-tauri/target/release/bundle/portable/Pliflo_<version>_x64-portable.exe`.
The portable EXE uses NSIS only as a compressed launcher. It requests no elevation,
creates no install/uninstall records or shortcuts, extracts to its private system-temp
plugin directory, waits for Pliflo, then cleans the payload on normal exit. Forced
termination/crashes can leave temp files. App preferences still use the user's normal
WebView2 profile; this is installation-free, not a fully self-contained user-data mode.
WebView2 must already be installed. Missing runtime startup failure is reported;
the portable launcher does not silently install a runtime. No DLLs are loaded from
a user-selected document directory. It remains unsigned, without claimed SmartScreen
reputation. Self-extraction and security scanning add startup cost.

## Regression and remaining acceptance gates

`scripts/generate-render-fixtures.py` writes original synthetic fixtures into a
new directory. Its development dependencies are python-docx, python-pptx,
openpyxl and Pillow. Supply a directory under the system temp root, including
Chinese characters and spaces. Generated files must not be committed.

Run `vp run test:rendering <fixtures...>` for browser preparation and native PDF
output. Use `bun test tests/print-lifecycle.test.ts` for the existing node:test
lifecycle suite; the font/protocol tests use `vp test`. The PE-import regression
is `vp test run scripts/windows-pe.test.ts`. Read-only driver testing is
`vp run test:native inspect_installed_printers -- --ignored --nocapture`.

Before declaring Windows supported, record:

- Packaged WebView2 import, WASM, binary IPC, preview, cancellation and cleanup.
- Chinese/mixed text, fallback, bold/italic, combining characters, emoji and embedded
  fonts; text extraction/search, actual fonts and embedding.
- DOCX mixed page sizes, PPTX, XLSX fit/100% wide-table pagination including the last
  column, Markdown/local images, raw PDF and corrupt-file isolation.
- Page count/dimensions, visible overlap/content loss, wall time, peak memory,
  PDF and installer sizes, and the same input's macOS comparison.
- Installation and launch in a clean Windows 11 x64 VM without Rust/Bun/MSYS2 or
  developer PATH. A sanitized PATH on the build host is only an intermediate check.
- Separately authorized spooler submission/cancellation and physical printing.

Windows 10, Windows ARM64, physical printing, pixel-identical Office layout and
older Windows compatibility are not implied by this development work.

## Measured development run (2026-09-21)

Host: Windows 11 x64 build 26200, WebView2 153.0.4234.48, Rust MSVC 1.98.1,
VS Build Tools 2022 / MSVC 14.44.35207 and the pinned gvsbuild archive above.
Latest public release checked before editing: v1.2.4. No release/tag was created.

- `check`, `check:native`, `desktop:build` and `git diff --check` passed.
  Native tests: 32 passed; one ignored read-only driver test separately passed.
  Protocol: 8 passed; PE imports: 1 passed; font adapter: 2 passed; lifecycle: 4 passed.
  Windows compilation retains unused macOS-helper warnings.
- NSIS installed on the development host. The installed app launched with PATH
  restricted to Windows/System32, invalid Fontconfig paths, a fresh WebView2 profile
  and Chinese/space temp paths. This is **not a clean VM test**.
- Final installed build startup: 2,319 ms; eight-file run including startup: 10,983 ms.
  Seven valid inputs succeeded; corrupt DOCX stayed failed without blocking later
  inputs. No JavaScript errors; WASM, binary IPC and PDF preview worked. All render
  sessions were removed after closing the viewer. No print commands were invoked.
- Discovery found OneNote (Desktop) and default Microsoft Print to PDF. Paper counts
  were 10 / 84; both reported color, neither reported duplex or trays.
- Mixed DOCX: 3 pages (612×792, 612×792, 720×504 pt), 200,760 bytes. Visual inspection
  covered Chinese, fallback, bold/italic, combining accents, joined emoji, tables,
  background and images. Zero-width joiners now retain the preceding font run when
  an adapter assigns the joiner another font.
- Embedded DOCX: 1 page / 3,831 bytes; fixture font subsets embedded with Unicode maps.
  PPTX: 2 pages / 22,440 bytes. XLSX fit-width: 2 pages / 116,981 bytes.
  Markdown: 1 page / 136,164 bytes. Image: 1 page / 4,521 bytes.
  Original PDF stayed the unchanged one-page, 955-byte source.
- XLSX 100% regression exposed existing right-column clipping. Shared pagination now
  splits complete columns using renderer geometry. The 24-column / 85-row fixture
  plus second sheet produced 7 pages / 131,066 bytes in 6,129 ms (native: 2,993 ms).
  Every expected cell marker and all 85 last-column markers survived extraction;
  the last segment was visually checked. A single column wider than the page fails
  explicitly; fit-width remains available.
- Native closure: 23 DLLs / 13,860,096 bytes; NSIS approximately 8.8 MiB, unsigned.
  Exact hashes and sizes are in the generated bundle manifest.

Single-run timings are not performance guarantees. Peak process-tree memory, macOS
same-file comparison, clean-machine/missing-WebView2 installation and broader locked
file/long-path tests remain unverified. The following continuation adds PDFium and
job operations; the authorized virtual-printer results below supersede the earlier submission gap. Physical output remains unverified.

Repeat integration with `bun scripts/check-windows-webview.ts <exe> <fixtures...>`.
It refuses print mutations, imports via the app drag-drop event boundary, and writes
PDFs, screenshot and JSON results into a fresh system-temp directory. This does not
test the operating system's drag gesture or file-picker UI.

## Printing and portable continuation

- Implemented GDI submission, early job ID return, background PDF rendering,
  conservative GetJob status mapping, SetJob cancellation, job identity validation,
  unconfirmed history state, and protection against closing during spooling.
- Unit tests cover n-up/range/reverse planning, color values, placement, identity
  validation and delivery-vs-completion. Read-only driver tests validate portrait,
  landscape and color settings without StartDoc. PDFium renders representative PDFs
  to a memory DC (not a printer); the mixed-text result was visually inspected.
- Final verification: 37 native tests passed, plus 3 opt-in read-only tests; 5
  frontend lifecycle tests passed. Six generated PDFs (DOCX, embedded font, PPTX,
  XLSX, Markdown, image) separately passed PDFium memory-DC rendering. `check`,
  native formatting and `git diff --check` passed.
- The portable EXE passed the eight-file WebView2 check with sanitized PATH, Chinese
  temp paths, corrupt-file isolation and preview. The launcher exited normally and
  its extracted payload directory was absent afterward. Initial measurement: 8,721 ms
  startup / 17,357 ms whole test. Final build: 8,703 ms startup / 17,456 ms batch;
  12,019,164-byte portable EXE and 12,120,236-byte installer. The final UI check
  restored a synthetic absent job using only GetJob, verified unconfirmed history,
  and inspected light/dark warning states. The DLL closure is 24 libraries,
  21,235,456 uncompressed bytes. Both EXEs are unsigned. These timings include extraction
  and machine-specific scanning, and are not equivalent to installed-app startup.
- Further submission/cancel tests, including virtual printers, require new explicit
  run-specific authorization. The initial authorized native-backend run is recorded below.

## Authorized virtual-printer validation (2026-09-21)

Exactly two synthetic jobs were explicitly authorized and executed against Windows
11 x64 Microsoft Print to PDF, through the production PDFium/GDI submission,
GetJob tracking and SetJob cancellation functions. No physical printer was used.
A test-only output path avoids the driver's Save As dialog; a test-only gate after
StartDoc makes cancellation before page rendering deterministic. Neither hook is
available in the production application. This verifies the native backend, not the
frontend print-button flow or the interactive Save As dialog.

- Job 2: accepted with an ID at 963 ms; observed submitted, printing, then
  unconfirmed at 3,091 ms. The driver removed the job without a completion report;
  the app correctly did not infer completion. Output was independently verified:
  three A4 pages, 258,189 bytes, from the 200,760-byte mixed-size synthetic PDF.
  All three rendered pages were inspected: Chinese/Latin text, accents, emoji,
  table and image survived; the landscape source page rotated to fit portrait A4.
- The virtual driver's output contained no embedded fonts or extractable text.
  Content inspection found vector paths (including text outlines), plus images on
  page one; pages two and three have no image objects. This is not whole-page rasterization,
  but searchable text is lost. Visual inspection is not a physical-print quality
  measurement, and vector output across other drivers is not guaranteed.
- Job 3: accepted at 366 ms, then cancelled before rendering the first page.
  Cancellation was confirmed by worker termination and queue absence at 470 ms;
  no output PDF was created. This does not validate cancellation mid-render or
  after a physical device has started feeding paper.
- Total test time was 3.60 seconds. The queue was empty afterward; the source SHA256
  remained unchanged. Timings are from one run and are not performance guarantees.

The ignored native test `authorized_virtual_print_two_jobs` is deliberately excluded
from normal `test:native`. It requires fresh user authorization for exactly two jobs,
`PLIFLO_ALLOW_VIRTUAL_PRINT=two-jobs-authorized`, and
`PLIFLO_VIRTUAL_PRINT_TEST_ROOT` pointing to a fresh `pliflo-authorized-print-*`
directory under system temp containing the synthetic three-page `source.pdf`.
It checks the exact virtual driver/port and creates a non-overwritable `run.jsonl`
marker before submitting. Run only that named test when authorized; never enable
all ignored tests with this authorization environment. Do not retry a failed run
or remove its marker without inspecting its recorded job IDs and obtaining new
authorization. Logs and generated PDFs stay outside the repository.

Physical printers, broader driver/settings coverage, rendering-time cancellation,
clean-machine installation, and same-file macOS comparison remain acceptance gates.

Printer status polling treats a zero Windows status mask as idle. Normal activity
(printing, busy, processing, I/O and warm-up) does not create a warning banner from
diagnostic text. Mapped faults retain their reasons; otherwise unmapped abnormal
flags retain diagnostics. Queue length alone is not a printer fault or proof of
physical completion.

Windows release executables use the GUI subsystem and do not allocate a console;
debug builds retain the console for development. If a running portable EXE locks
the default output, set `PLIFLO_PORTABLE_OUTPUT` to a different output filename
before `vp run desktop:build`; do not terminate the user’s running app to overwrite it.

## Cancellation, boundaries and launch performance continuation

No spooler submission or cancellation API was invoked for this continuation.
The production page-operation sequence now checks cancellation before and after
StartPage, each PDFium draw, EndPage and EndDoc. Tests inject cancellation at every
step and failures at each operation; no later operation runs after either event.
In particular, cancellation during a draw does not proceed to EndPage. GDI clipping
and restore failures are surfaced. Rust rendering panics are caught, unfinished
DCs are aborted, and worker completion is exposed after resource teardown.
This cannot forcibly interrupt an in-flight PDFium/GDI call, hung driver or device
already printing. It is not proof of physical mid-page cancellation.

Missing/non-file inputs are returned as individual inspection failures instead
of aborting batch import. Generated-PDF cleanup retries sharing violations after
150, 500 and 1,500 ms; original PDFs are never targeted. Persistent locks remain
for the existing 48-hour stale-cache cleanup. Native tests cover Unicode/spaces,
paths longer than 260 characters, exclusive file locks, failed cleanup followed by
successful retry, and source-content preservation.

A WebView2 batch used 17 synthetic inputs under a 336-character directory path:
15 succeeded and two (corrupt DOCX and missing DOCX) remained failed. The successful
inputs totaled 67 pages. All 1,600 paragraph markers in eight seven-page Markdown
outputs survived extraction. Generated PDFs totaled 696,614 bytes. On this host,
startup was 2,998 ms and startup plus preparation was 16,514 ms. There were no JS
errors or remaining render sessions after cleanup. Original source bytes were
not modified. This run used the ZIP-notices/LZMA candidate below.

A 100-ms Win32 sampler measured the launcher/app/WebView2 process tree: peak summed
working set 1,495,564,288 bytes and summed private commit 1,378,455,552 bytes for
that mixed batch. An eight-Markdown-only run (56 pages) took 8,462 ms including
1,797-ms startup, peaking at 1,084,993,536 bytes summed working set / 963,420,160
bytes private commit. Native app private commit peaked at 228,528,128 bytes in that
run; WebView2 processes also contributed substantially. Shared working-set pages
can be counted twice, private commit is not resident RAM, and sampling can miss
short peaks. Memory remains relatively high; these results do not establish
large-document/low-memory reliability or prove absence of long-run leaks.

### Portable startup comparison

All launches used sanitized PATH, Chinese temp paths, a fresh extraction directory,
and an isolated WebView2 profile reused after the first run. Readiness means the
workspace DOM is present via CDP; this is not a rebooted-machine cold-start benchmark.

| Candidate                          |  EXE bytes | Fresh profile, ms | Reused profile, ms |
| ---------------------------------- | ---------: | ----------------: | -----------------: |
| Previous solid LZMA, loose notices | 12,020,241 |             3,718 |      3,880 / 3,846 |
| Solid LZMA, ZIP notices            | 12,871,029 |             7,841 |      3,153 / 2,962 |
| zlib, ZIP notices (selected)       | 16,527,674 |             3,917 |      2,009 / 1,905 |

The selected approach roughly halves the measured repeated-launch time at a cost
of about 4.3 MiB over the previous package. First-run scanning/cache variation is
visible; do not promise a two-second first launch. No persistent DLL cache, security
exclusion or extra runtime was introduced. All 453 original notice files were
verified byte-for-byte inside `third-party.zip`, reducing extraction to one notice
archive instead of hundreds of small files. Windows Explorer opens that archive.
The launcher still deletes its payload on normal exit.

Reproduce launch measurements with
`bun scripts/check-windows-startup.ts <portable-exe> 3`.
The integration script `check-windows-webview.ts` accepts
`PLIFLO_EXPECT_FAILED` as semicolon-separated fixture basenames (default:
`corrupt.docx`). Set `PLIFLO_MEMORY_PYTHON` to a development Python executable to
sample the process tree with `sample-windows-memory.py` (standard library only).
These tools do not submit jobs. Reports, profiles and PDFs stay in system temp.

Final verification: 42 default native tests and six lifecycle/cleanup tests passed;
`check`, `check:native`, formatting and `git diff --check` passed. The final
16,527,675-byte portable build passed a fresh-profile WebView2 run (3,973-ms startup)
with a Markdown input, original PDF and missing input, plus cleanup and restored
unconfirmed-job checks. No printing was submitted. All 16 existing sources in the
17-input boundary batch were compared with their original synthetic bytes and
remained unchanged. Actual mid-print device cancellation and stuck-driver recovery
remain unverified and require separate run-specific printing authorization.

## Memory and document regression continuation

Windows no longer constructs an unused default Win32 font map before replacing
it with the document's FreeType map. A standalone repeated-render probe reproduced
approximately 24 MiB growth per document with the unused map; removing it reduced
the observed private commit at document 56 from 1,359 MiB to 19 MiB. The final
implementation keeps document-private font maps and embedded-font cleanup, with
no shared mutable font map or change to macOS CoreText selection. Explicit global
font-cache resets and forced JavaScript GC are not application behavior.

Canvas encoding now releases recording commands, image promises and patched
context methods, as well as resetting backing canvas dimensions. Temporary image
snapshot canvases are reset after their PNG callback completes. The real-browser
recorder lifecycle check verifies repeated record/encode/release, preserved image
dimensions, restored methods and rejection of encoding after release.

Three import/remove cycles each used the same 17 synthetic inputs and 67 pages.
The original optimized portable executable was the baseline. A repeat of the
final portable build, including the Markdown image fix and with no build running,
produced these results (100-ms process-tree
sampling; MiB = 1,048,576 bytes):

| Measurement                                       |                    Baseline |               Memory fix |
| ------------------------------------------------- | --------------------------: | -----------------------: |
| Peak summed private commit                        |                   2,173 MiB |                1,473 MiB |
| Peak summed working set                           |                   2,322 MiB |                1,656 MiB |
| Native app peak private commit                    |                   1,061 MiB |                  297 MiB |
| After third removal + 3.5 seconds, private commit |                   1,558 MiB |                  553 MiB |
| Batch preparation, rounds 1 / 2 / 3               | 12,585 / 11,756 / 11,670 ms | 5,916 / 4,817 / 4,610 ms |

The native app was at 34 / 33 / 36 MiB after removal of each batch. Total private
commit after removal was 690 / 619 / 553 MiB, showing WebView2/GC variation rather
than the previous steady growth. Earlier repeats ended at 611 and 722 MiB. A diagnostic
forced-GC snapshot reached 429 MiB but is **excluded** from the normal-use figures.
Shared working-set pages can be double-counted, private commit is not resident
RAM, and the sampler can miss brief peaks. This is evidence of improvement, not
proof of leak-free long-duration use or suitability for low-memory machines.

The expanded synthetic fixtures check Chinese/English, missing-family fallback,
bold/italic, combining characters, emoji, twelve-page DOCX tables and images,
eight-slide PPTX, 4,096 × 2,048 PNG/JPEG, a 100-row × 32-column worksheet, long
Markdown paragraphs/quotes/code/table cells, local Markdown images, and a
three-page PDF with mixed MediaBox sizes. Existing fixtures additionally cover
session-local embedded fonts and mixed-size DOCX. The worksheet retained all
3,200 cell markers in both fit-width (two pages) and 100% (four pages) modes.
Font diagnostics observed the embedded Pliflo Fixture face, Windows system faces,
Segoe UI Emoji and fallback faces; PDF font inspection reported embedded fonts
and Unicode mappings. This does not establish full RTL/emoji extraction fidelity.

Regression fixes include splitting long Markdown blocks and oversized table
rows at page boundaries, restoring text styles after page changes, and keeping
oversized-row fragments with their headers. Local Markdown images now normalize
Windows separators and decode URL-encoded filenames before safe relative-path
checks; paragraph/linked images preserve their position relative to surrounding
text. Remote, data and parent-directory image references remain excluded. Failed
PDF parsing, encryption and zero readable pages are reported as individual file
failures instead of silently returning an unknown page count.

Use `generate-regression-fixtures.py`, `check-windows-webview.ts` and
`check-regression-pdfs.py` as described in [CONTRIBUTING.md](CONTRIBUTING.md).
The validator checks content markers, page counts, MediaBox sizes, embedded image
counts and text outside the page. Rendered pages must also be inspected visually;
marker checks alone cannot detect all overlap, clipping or Office fidelity errors.
Original-source hashes are checked after the WebView2 run, and session/portable
extraction cleanup is asserted. `check-windows-cycles.ts` repeats three batches
and records normal heap snapshots separately from diagnostic forced GC.

Native verification passed 44 tests (four hardware/explicit integration tests
remain ignored), eight protocol tests, six lifecycle/cleanup tests and the actual
Edge-to-Cairo rendering check including recorder lifecycle and embedded fonts.
No print submission or cancellation API was invoked. macOS comparison, clean-VM
installation, low-memory/very-large-document endurance and physical printing are
still separate acceptance gates.

Final portable output is
`src-tauri/target/release/bundle/portable/Pliflo_1.2.4_x64-portable-regression.exe`
(16,527,887 bytes, unsigned). The NSIS output is
`src-tauri/target/release/bundle/nsis/Pliflo_1.2.4_x64-setup.exe`
(12,959,591 bytes). Native DLL closure remains 24 libraries / 21,235,456 bytes.
No development environment is bundled.

The final EXE passed the expanded 11-input WebView2 batch: nine successful files,
37 pages and two expected failures (broken/encrypted PDF). All 5,118 content
markers and 25 image instances were present; no characters fell outside page
bounds. Selected rendered pages were visually inspected, including long-table
continuation and both local Markdown images. Generated PDFs totaled 2,842,472
bytes. Startup was 4,460 ms and startup plus preparation 19,706 ms; process-tree
private commit peaked at 1,537,769,472 bytes. This workload includes repeated
8-megapixel images and still has a high WebView2 peak. The fresh 100% worksheet
run took 6,800 ms including startup and both fit-width/100% preparations, retained
all 3,200 markers on four pages and loaded its PDF preview. Both runs completed
without JS errors, changed source hashes or leftover render sessions/extracted
payloads. Formatting, frontend checks, native checks and packaging passed.
