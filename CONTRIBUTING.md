# Contributing

Start with [README.md](README.md) or [简体中文](README.zh-CN.md) for setup and
supported behavior. [AGENTS.md](AGENTS.md) contains maintenance rules;
[PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) describe product and UI scope.

## Development

Install dependencies from the repository root with `bun install --frozen-lockfile`.
Use the root Bun/Cargo workspaces and lockfiles. Do not depend on sibling checkouts
or add a second OOXML parser to the recorder or renderer.

Keep changes focused and describe what changes for the user. Preserve source
documents, binary page transfer, bounded preparation, cancellation and observable
failures. Keep unsupported Canvas operations explicit rather than silently
discarding them.

## Checks

Run the checks relevant to your changes locally; ordinary pushes and PRs do not
run CI automatically.

| Change               | Checks                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Frontend             | `vp run check`, `vp run build`                                                                                |
| Recorder or protocol | `vp run test:protocol`, `vp run test:native -p canvas-cairo-replay`                                           |
| Native application   | `vp run test:native`, `vp run fmt:native`                                                                     |
| Document rendering   | `vp run test:rendering <local document> [...]`; inspect output PDFs as well as extracted text and page counts |
| Packaging            | `vp run desktop:build`; inspect the app signature, bundled libraries and minimum OS requirement               |
| Documentation        | Check relative links, command names and consistency between English and Chinese README files                  |

Never submit a real print job as a smoke test. Printer discovery is read-only;
physical-device testing requires explicit authorization for that run. Do not
commit private documents or generated PDFs. Use synthetic or authorized samples.

## Changes and releases

- Use focused Chinese Conventional Commit messages; public release notes and
  annotated tag messages are English.
- Describe behavior, validation and known limitations in a PR. Do not equate a
  successful system submission with confirmed physical output.
- Keep README setup, commands and limitations aligned in both languages. Preserve
  the original notices in imported modules and update license metadata when needed.
- A `v*` tag starts macOS release builds for Apple Silicon and Intel. Update
  `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` and the root
  Cargo lockfile consistently before tagging. Release builds run checks before
  uploading DMGs; never move a published tag to another commit.
- Use `vp run desktop:build`, not bare `tauri build`, to package native libraries
  and notices. Local builds may require a newer macOS version than release builds.
- The release workflow can also be dispatched manually on a branch to validate
  both macOS architectures without uploading release assets or creating a tag.
- Before choosing a release version or creating its tag, run that manual build
  and confirm both architectures pass. Fix failures on the branch first.
- Tag builds upload packages to a draft release. Publish the draft only after
  both jobs succeed, both DMGs are uploaded and the English release notes are
  reviewed. Remove abandoned drafts without deleting tags, commits or build
  records; do not move published tags to retry a release.

Project code uses [MIT](LICENSE); third-party notices remain in effect as described
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
