import type { EmbeddedFontRef } from "@silurus/ooxml/docx";
import type { FontResource } from "@pliflo/canvas-recorder/protocol";

/** 使用公开的文档资源接口，不拦截全局 FontFace，也不将文档字体安装到系统。 */
export async function documentFonts(
  references: readonly EmbeddedFontRef[],
  read: (path: string) => Promise<Uint8Array>,
): Promise<FontResource[]> {
  if (references.length > 64) throw new Error("Too many embedded fonts");
  const fonts: FontResource[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const ref of references) {
    const identity = `${ref.fontName.trim().toLowerCase()}:${ref.style}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const bytes = new Uint8Array(await read(ref.partPath));
    total += bytes.byteLength;
    if (total > 64 * 1024 * 1024) throw new Error("Embedded fonts exceed document resource limits");
    if (ref.partPath.toLowerCase().endsWith(".odttf")) {
      const key = ref.fontKey.replace(/[{}-]/g, "");
      if (!/^[\da-f]{32}$/i.test(key) || bytes.length < 32)
        throw new Error("Invalid embedded font obfuscation");
      // ECMA-376: GUID 字节倒序后，与字体前 32 字节循环异或。
      const mask = key
        .match(/../g)!
        .map((hex) => Number.parseInt(hex, 16))
        .reverse();
      for (let index = 0; index < 32; index += 1) bytes[index] ^= mask[index % 16];
    }
    fonts.push({
      family: ref.fontName.trim(),
      weight: ref.style === "bold" || ref.style === "boldItalic" ? 700 : 400,
      style: ref.style === "italic" || ref.style === "boldItalic" ? "italic" : "normal",
      bytes,
    });
  }
  return fonts;
}
