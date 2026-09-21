import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { peImports } from "./windows-pe";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Windows x64 build host required");
if (process.argv.slice(2).length)
  throw new Error("Windows packaging supports NSIS only; no extra arguments");
const native = process.env.PLIFLO_NATIVE_PREFIX;
if (!native)
  throw new Error(
    "Set PLIFLO_NATIVE_PREFIX to an MSVC x64 Cairo/Pango installation (see WINDOWS.md)",
  );
const prefix = resolve(native);
const pdfium = resolve(process.env.PLIFLO_PDFIUM_PREFIX ?? "src-tauri/target/windows-tools/pdfium");
const pdfiumDll = join(pdfium, "bin/pdfium.dll");
if (
  !existsSync(pdfiumDll) ||
  createHash("sha256").update(readFileSync(pdfiumDll)).digest("hex") !==
    "55e7ebef29a1ec9523d1adb8b260a73e7dfb0f64d3f0285121d20ecd6148ef18"
)
  throw new Error("Missing or unverified PDFium chromium/8057 x64; see WINDOWS.md");
const rust = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
if (
  !rust.includes("host: x86_64-pc-windows-msvc") ||
  (process.env.CARGO_BUILD_TARGET && process.env.CARGO_BUILD_TARGET !== "x86_64-pc-windows-msvc")
)
  throw new Error("Use x86_64-pc-windows-msvc throughout; MinGW libraries are unsupported");
const env = {
  ...process.env,
  PATH: `${join(prefix, "bin")};${process.env.PATH}`,
  PKG_CONFIG_PATH: `${join(prefix, "lib/pkgconfig")};${join(prefix, "share/pkgconfig")}`,
  LIB: `${join(prefix, "lib")};${process.env.LIB ?? ""}`,
};
execFileSync("pkg-config", ["--atleast-version=1.56", "pangoft2"], { env });
execFileSync(process.execPath, ["run", "tauri", "build", "--no-bundle"], { env, stdio: "inherit" });
const binary = resolve("src-tauri/target/release/pliflo.exe");
const directory = mkdtempSync(resolve("src-tauri/target/windows-bundle-"));
const notices = join(directory, "third-party");
mkdirSync(notices);
const noticeArchive = join(directory, "third-party.zip");
const resources: Record<string, string> = { [noticeArchive]: "third-party.zip" };
const sources = [join(prefix, "bin"), join(pdfium, "bin")];
if (process.env.PLIFLO_VC_REDIST) sources.push(resolve(process.env.PLIFLO_VC_REDIST));
const available = new Map<string, string>();
for (const source of sources)
  for (const name of readdirSync(source)) {
    if (/\.dll$/i.test(name)) available.set(name.toLowerCase(), join(source, name));
  }
const libraries = new Map<
  string,
  { source: string; bytes: number; sha256: string; imports: string[] }
>();
const system = new Set<string>();
function collect(path: string) {
  for (const name of peImports(path)) {
    if (libraries.has(name) || system.has(name)) continue;
    if (/^(api-ms-|ext-ms-)/.test(name)) {
      system.add(name);
      continue;
    }
    const source = available.get(name);
    if (!source) {
      // The VC runtime is redistributable, not an assumed OS component.
      if (
        !/^(msvcp|vcruntime|concrt)/.test(name) &&
        existsSync(join(process.env.SystemRoot!, "System32", name))
      ) {
        system.add(name);
        continue;
      }
      throw new Error(
        `Unresolved DLL ${name} required by ${path}; supply MSVC libraries / PLIFLO_VC_REDIST`,
      );
    }
    if (/^(libgcc|libstdc\+\+|libwinpthread|msys-)/.test(name))
      throw new Error(`MinGW/MSYS dependency rejected: ${name}`);
    libraries.set(name, {
      source,
      bytes: statSync(source).size,
      sha256: createHash("sha256").update(readFileSync(source)).digest("hex"),
      imports: peImports(source),
    });
    const target = join(directory, name);
    copyFileSync(source, target);
    resources[target] = name;
    collect(source);
  }
}
collect(binary);
// PDFium is loaded by an absolute app-local path, so it is not in PE imports.
const pdfiumTarget = join(directory, "pdfium.dll");
copyFileSync(pdfiumDll, pdfiumTarget);
resources[pdfiumTarget] = "pdfium.dll";
libraries.set("pdfium.dll", {
  source: pdfiumDll,
  bytes: statSync(pdfiumDll).size,
  sha256: createHash("sha256").update(readFileSync(pdfiumDll)).digest("hex"),
  imports: peImports(pdfiumDll),
});
collect(pdfiumDll);
// gvsbuild installs upstream COPYING/license material with its native stack.
const nativeNotices = join(prefix, "share/doc");
if (!existsSync(nativeNotices)) throw new Error("Native license notices missing: share/doc");
cpSync(nativeNotices, join(notices, "native"), { recursive: true });
cpSync(join(pdfium, "licenses"), join(notices, "pdfium"), { recursive: true });
copyFileSync(join(pdfium, "LICENSE"), join(notices, "pdfium-binaries-LICENSE"));
copyFileSync(join(pdfium, "VERSION"), join(notices, "pdfium-VERSION"));
copyFileSync(join(pdfium, "args.gn"), join(notices, "pdfium-build-args.gn"));
for (const source of [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "packages/canvas-recorder/LICENSE",
  "crates/cairo-replay/LICENSE",
  "node_modules/@silurus/ooxml/LICENSE",
  "node_modules/@silurus/ooxml/THIRD_PARTY_NOTICES.md",
])
  copyFileSync(source, join(notices, source.replaceAll("/", "-")));
const manifest = {
  architecture: "x64",
  toolchain: rust.trim(),
  nativePrefix: prefix,
  nativeBytes: [...libraries.values()].reduce((sum, item) => sum + item.bytes, 0),
  libraries: Object.fromEntries(libraries),
  systemImports: [...system].sort(),
};
writeFileSync("src-tauri/target/native-bundle-manifest.json", JSON.stringify(manifest, null, 2));
// Keep full source paths in the local audit manifest, not in distributed packages.
const packagedManifest = {
  ...manifest,
  nativePrefix: undefined,
  libraries: Object.fromEntries(
    [...libraries].map(([name, item]) => [name, { ...item, source: basename(item.source) }]),
  ),
};
writeFileSync(
  join(notices, "native-bundle-manifest.json"),
  JSON.stringify(packagedManifest, null, 2),
);
// Preserve every notice, but avoid hundreds of tiny writes/scans on each portable
// launch. Windows Explorer can open the archive without another runtime.
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:PLIFLO_NOTICE_SOURCE, $env:PLIFLO_NOTICE_ARCHIVE)",
  ],
  {
    env: { ...env, PLIFLO_NOTICE_SOURCE: notices, PLIFLO_NOTICE_ARCHIVE: noticeArchive },
    windowsHide: true,
    stdio: "inherit",
  },
);
const config = join(directory, "bundle.json");
writeFileSync(config, JSON.stringify({ bundle: { resources } }));
execFileSync(
  process.execPath,
  ["run", "tauri", "bundle", "--config", config, "--bundles", "nsis"],
  { env, stdio: "inherit" },
);
// Portable payload must use the post-bundle executable, with identical DLL closure.
copyFileSync(binary, join(directory, "pliflo.exe"));
const { buildPortable } = await import("./windows-portable");
const portable = buildPortable(directory);
console.log(
  JSON.stringify({
    installerDirectory: resolve("src-tauri/target/release/bundle/nsis"),
    nativeBytes: manifest.nativeBytes,
    nativeLibraries: libraries.size,
    staging: directory,
    executable: basename(binary),
    portable,
  }),
);
