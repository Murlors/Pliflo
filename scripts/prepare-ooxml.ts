import { readFile, writeFile, mkdir, mkdtemp, cp, rename, rm, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const moduleName = "xlsx-CRcSzZNq.js";
const expected = "4a6abd47539a85e25685c94c85f6be5f96fe9d8c0c9b53fd3f9dc8601b78305f";
const runtimeDirectory = resolve(root, "node_modules/.cache/pliflo-ooxml");
const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** 输出独立、带许可证的构建副本；不修改安装目录，不在HTTP请求中改写源码。 */
async function buildOoxmlRuntime(
  source = resolve(root, "node_modules/@silurus/ooxml"),
  target = runtimeDirectory,
) {
  const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  const original = await readFile(join(source, "dist", moduleName), "utf8");
  if (pkg.version !== "0.87.0" || digest(original) !== expected)
    throw Error("Unsupported OOXML build; review geometry compatibility before upgrading");
  const extension = await readFile(resolve(root, "compat/ooxml/ooxml-0.87.0-xlsx.js"), "utf8");
  const patched = original + "\n" + extension;
  const manifest = {
    upstreamVersion: pkg.version,
    sourceSha256: expected,
    extensionSha256: digest(extension),
    outputSha256: digest(patched),
  };
  try {
    const existing = JSON.parse(await readFile(join(target, "compatibility.json"), "utf8"));
    if (
      JSON.stringify(existing) !== JSON.stringify(manifest) ||
      digest(await readFile(join(target, "dist", moduleName))) !== manifest.outputSha256
    )
      throw Error("Existing runtime differs; build into a new output directory");
    await access(join(target, "dist/xlsx-print-geometry.mjs"));
    return target;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await mkdir(resolve(target, ".."), { recursive: true });
  const staging = await mkdtemp(target + "-build-");
  try {
    await cp(join(source, "dist"), join(staging, "dist"), { recursive: true });
    for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
      await cp(join(source, name), join(staging, name));
    await writeFile(join(staging, "dist", moduleName), patched);
    await writeFile(
      join(staging, "dist/xlsx-print-geometry.mjs"),
      `export {worksheetRenderWidth} from './${moduleName}';\n`,
    );
    await writeFile(join(staging, "compatibility.json"), JSON.stringify(manifest));
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return target;
}
await buildOoxmlRuntime();
