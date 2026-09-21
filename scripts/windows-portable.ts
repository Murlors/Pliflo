import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** NSIS is used only as a signed-able extraction launcher: no installer sections,
 * registry entries, shortcuts, elevation or external print applications. */
export function buildPortable(payload: string) {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const output = resolve(
    process.env.PLIFLO_PORTABLE_OUTPUT ??
      `src-tauri/target/release/bundle/portable/Pliflo_${version}_x64-portable.exe`,
  );
  mkdirSync(resolve(output, ".."), { recursive: true });
  const compiler =
    process.env.PLIFLO_MAKENSIS ?? join(process.env.LOCALAPPDATA!, "tauri/NSIS/makensis.exe");
  if (!existsSync(compiler)) throw new Error("NSIS compiler missing; set PLIFLO_MAKENSIS");
  const quote = (path: string) => {
    if (/["$\r\n]/.test(path)) throw new Error("Unsupported NSIS build path");
    return `"${path.replaceAll("/", "\\")}"`;
  };
  const script = join(payload, "portable.nsi");
  writeFileSync(
    script,
    `\uFEFFUnicode true
RequestExecutionLevel user
SilentInstall silent
; Fast launch is worth a modest size increase over solid LZMA. Notices stay zipped.
SetCompressor zlib
ManifestDPIAware true
ManifestLongPathAware true
Name "Pliflo Portable"
OutFile ${quote(output)}
Icon ${quote(resolve("src-tauri/icons/icon.ico"))}
VIProductVersion "${version}.0"
VIAddVersionKey "ProductName" "Pliflo Portable"
VIAddVersionKey "FileDescription" "Pliflo portable launcher"
VIAddVersionKey "FileVersion" "${version}"
VIAddVersionKey "LegalCopyright" "Pliflo contributors"
Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\\Pliflo"
  File ${quote(join(payload, "pliflo.exe"))}
  File ${quote(join(payload, "*.dll"))}
  File ${quote(join(payload, "third-party.zip"))}
  ClearErrors
  ExecWait '"$PLUGINSDIR\\Pliflo\\pliflo.exe"' $0
  IfErrors failed
  StrCmp $0 0 done
failed:
  MessageBox MB_OK|MB_ICONSTOP "Pliflo could not start. Check that Microsoft Edge WebView2 Runtime is installed. / 请检查是否已安装 Microsoft Edge WebView2 运行时。"
done:
  SetOutPath "$TEMP"
SectionEnd
`,
  );
  execFileSync(compiler, ["/V2", script], { stdio: "inherit" });
  return output;
}
