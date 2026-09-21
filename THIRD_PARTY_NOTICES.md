# Third-party notices

Pliflo's own code is licensed under the [MIT License](LICENSE). This does not
replace the licenses or copyright notices of third-party code and libraries.

Windows development uses MSVC builds of the same Cairo/Pango/FreeType/Fontconfig
stack. The Windows packager includes upstream native notices from `share/doc`,
project notices and a DLL hash/size inventory. Visual C++ runtime redistribution
must follow the installed Visual Studio license. The gvsbuild development archive
is a build input, not a library license or a completed distribution audit; pinned
source recipes and remaining release gates are documented in [WINDOWS.md](WINDOWS.md).
Windows packages include PDFium chromium/8057 (155.0.8057.0), using the
non-V8/non-XFA x64 build from bblanchon/pdfium-binaries. PDFium uses a BSD-style
license; its third-party libraries retain their own terms. The package includes
the complete archive `licenses` directory, build arguments, version, and the
binary distributor's MIT notice under `pdfium*` inside the Windows `third-party.zip` archive. PDFium is used to
read/render PDFs into Windows GDI, not to generate Pliflo's document PDFs.

## Source included in this repository

| Location                   | Origin                                      | Notice                                  |
| -------------------------- | ------------------------------------------- | --------------------------------------- |
| `packages/canvas-recorder` | canvas-cairo-pdf recorder and protocol      | [MIT](packages/canvas-recorder/LICENSE) |
| `crates/cairo-replay`      | canvas-cairo-pdf Rust renderer              | [MIT](crates/cairo-replay/LICENSE)      |
| `compat/ooxml`             | canvas-cairo-pdf worksheet geometry adapter | [MIT](compat/ooxml/LICENSE)             |

Keep these original notices when modifying or redistributing the modules.

## Installed dependencies

JavaScript and Rust dependency versions are recorded in the root `bun.lock` and
`Cargo.lock`. Their individual licenses remain applicable. The installed
`@silurus/ooxml` package supplies its own `LICENSE` and `THIRD_PARTY_NOTICES.md`;
the build-time runtime copy retains both files.

## Native libraries in macOS packages

The desktop build collects the actual dynamically linked Cairo/Pango dependency
graph. It copies available license/copyright files, Homebrew SPDX inventories
and build recipes into `Pliflo.app/Contents/Resources/third-party`, alongside the
Pliflo, recorder, renderer and OOXML notices. Native libraries retain their own
licenses; they are not relicensed under Pliflo's MIT license. No fonts are bundled.

`src-tauri/target/native-bundle-manifest.json` records the exact libraries and
versions used by a local build. This manifest and the copied notices are an
inventory, not a complete license-compliance audit. Before redistributing a
different dependency build, review its applicable notices and source requirements.
