import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const run = (tool: string, args: string[]) => execFileSync(tool, args, { encoding: "utf8" }).trim();
const bun = process.execPath;
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--app-only"))
  throw new Error("Only --app-only is supported; build on the target architecture");
if (process.platform !== "darwin")
  throw new Error("Native dependency packaging is currently supported on macOS only");
execFileSync(bun, ["run", "tauri", "build", "--no-bundle"], { stdio: "inherit" });

// 操作构建副本，不修改 Homebrew 库；bundle 完成后恢复 Cargo 的原始产物。
const binary = resolve("src-tauri/target/release/pliflo");
const directory = mkdtempSync(resolve("src-tauri/target/native-bundle-"));
const original = join(directory, "pliflo-original");
copyFileSync(binary, original);
const libraries = join(directory, "lib");
mkdirSync(libraries);
const dependencies = (path: string) =>
  run("otool", ["-L", path])
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" (compatibility")[0]);
const system = (path: string) =>
  path.startsWith("/usr/lib/") || path.startsWith("/System/Library/");
type Item = {
  source: string;
  target: string;
  minimum?: string;
  edges: { name: string; item: Item }[];
};
const items = new Map<string, Item>(),
  names = new Map<string, string>();
function collect(source: string, executable = false): Item {
  const real = realpathSync(source),
    found = items.get(real);
  if (found) return found;
  const name = basename(source);
  if (names.has(name) && names.get(name) !== real)
    throw new Error(`Native library name collision: ${name}`);
  names.set(name, real);
  const item: Item = {
    source: real,
    target: executable ? binary : join(libraries, name),
    edges: [],
  };
  items.set(real, item);
  for (const dep of dependencies(real)) {
    if (system(dep)) continue;
    if (!dep.startsWith("/")) throw new Error(`Unresolved dependency: ${dep}`);
    if (realpathSync(dep) !== real) item.edges.push({ name: dep, item: collect(dep) });
  }
  return item;
}
try {
  const main = collect(binary, true);
  let minimum = "10.13";
  const newer = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }) > 0;
  for (const item of items.values()) {
    for (const match of run("otool", ["-l", item.source]).matchAll(
      /(?:\n\s+minos |LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version )(\d+\.\d+(?:\.\d+)?)/g,
    )) {
      if (!item.minimum || newer(match[1], item.minimum)) item.minimum = match[1];
      if (newer(match[1], minimum)) minimum = match[1];
    }
    if (item !== main) {
      copyFileSync(item.source, item.target);
      chmodSync(item.target, statSync(item.target).mode | 0o200);
    }
  }
  for (const item of items.values()) {
    const edits: string[] = [];
    if (item !== main) edits.push("-id", `@loader_path/${basename(item.target)}`);
    for (const edge of item.edges)
      edits.push(
        "-change",
        edge.name,
        `${item === main ? "@executable_path/../Frameworks" : "@loader_path"}/${basename(edge.item.target)}`,
      );
    if (edits.length) run("install_name_tool", [...edits, item.target]);
    // 只剥离构建副本的本地符号，保留动态链接所需导出；随后重新签名。
    if (item !== main) run("strip", ["-x", item.target]);
    run("codesign", ["--force", "--sign", "-", item.target]);
    if (
      dependencies(item.target).some(
        (dep) =>
          !system(dep) &&
          !dep.startsWith("@loader_path/") &&
          !dep.startsWith("@executable_path/../Frameworks/"),
      )
    )
      throw new Error("Unresolved bundled dependency");
  }
  const config = join(directory, "bundle.json");
  const frameworks = [...items.values()].filter((item) => item !== main).map((item) => item.target);
  // 随实际链接的 Homebrew 库携带许可证、源码出处和对应构建配方。
  const notices = join(directory, "third-party");
  mkdirSync(notices);
  for (const prefix of new Set(
    [...items.values()]
      .filter((item) => item !== main)
      .map((item) => dirname(dirname(item.source))),
  )) {
    const target = join(notices, `${basename(dirname(prefix))}-${basename(prefix)}`);
    mkdirSync(target);
    for (const entry of readdirSync(prefix)) {
      if (/^(copying|copyright|licen[cs]e|authors|notice|[al]?gpl|ftl)/i.test(entry))
        cpSync(join(prefix, entry), join(target, entry), { recursive: true });
    }
    for (const entry of ["sbom.spdx.json", ".brew"]) {
      if (existsSync(join(prefix, entry)))
        cpSync(join(prefix, entry), join(target, entry), { recursive: true });
    }
  }
  for (const [name, source] of Object.entries({
    "canvas-recorder": "packages/canvas-recorder/LICENSE",
    "cairo-replay": "crates/cairo-replay/LICENSE",
    ooxml: "node_modules/@silurus/ooxml/LICENSE",
    "ooxml-third-party": "node_modules/@silurus/ooxml/THIRD_PARTY_NOTICES.md",
  }))
    copyFileSync(resolve(source), join(notices, `${name}.txt`));
  writeFileSync(
    config,
    JSON.stringify({
      bundle: {
        resources: { [notices]: "third-party" },
        macOS: {
          frameworks,
          minimumSystemVersion: minimum,
          signingIdentity: process.env.APPLE_SIGNING_IDENTITY ?? "-",
        },
      },
    }),
  );
  const manifest = resolve("src-tauri/target/native-bundle-manifest.json");
  writeFileSync(
    manifest,
    JSON.stringify(
      {
        architecture: process.arch,
        minimumSystemVersion: minimum,
        nativeBytes: frameworks.reduce((total, path) => total + statSync(path).size, 0),
        libraries: [...items.values()]
          .filter((item) => item !== main)
          .map((item) => ({
            source: item.source,
            bundledName: basename(item.target),
            minimumSystemVersion: item.minimum,
            originalBytes: statSync(item.source).size,
            bundledBytes: statSync(item.target).size,
          })),
      },
      null,
      2,
    ),
  );
  execFileSync(
    bun,
    [
      "run",
      "tauri",
      "bundle",
      "--config",
      config,
      "--bundles",
      args.includes("--app-only") ? "app" : "app,dmg",
    ],
    { stdio: "inherit" },
  );
  run("codesign", [
    "--verify",
    "--deep",
    "--strict",
    resolve("src-tauri/target/release/bundle/macos/Pliflo.app"),
  ]);
  console.log(
    JSON.stringify({
      nativeLibraries: frameworks.length,
      minimumSystemVersion: minimum,
      manifest,
    }),
  );
} finally {
  copyFileSync(original, binary);
  // 恢复成功后才删除本次创建的副本，避免构建缓存无限积累。
  rmSync(directory, { recursive: true, force: true });
}
