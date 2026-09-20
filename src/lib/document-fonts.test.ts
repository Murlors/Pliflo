import { expect, it } from "vite-plus/test";
import { documentFonts } from "./document-fonts";

it("decodes ODTTF without mutating source data and preserves face metadata", async () => {
  const original = Uint8Array.from({ length: 40 }, (_, index) => index);
  const obfuscated = original.slice();
  const key = "00112233445566778899aabbccddeeff";
  const mask = key
    .match(/../g)!
    .map((value) => Number.parseInt(value, 16))
    .reverse();
  for (let index = 0; index < 32; index += 1) obfuscated[index] ^= mask[index % 16];
  const reference = {
    fontName: "Fixture",
    style: "boldItalic" as const,
    partPath: "word/fonts/test.odttf",
    fontKey: `{${key}}`,
  };
  const fonts = await documentFonts([reference, reference], async () => obfuscated);
  expect(fonts).toEqual([{ family: "Fixture", weight: 700, style: "italic", bytes: original }]);
  expect(obfuscated).not.toEqual(original);
  await expect(
    documentFonts([{ ...reference, fontKey: "invalid" }], async () => obfuscated),
  ).rejects.toThrow("obfuscation");
  await expect(documentFonts([{ ...reference }], async () => new Uint8Array(1))).rejects.toThrow(
    "obfuscation",
  );
});

it("rejects unbounded font resources before transport", async () => {
  const ref = { fontName: "Fixture", style: "regular" as const, partPath: "font.ttf", fontKey: "" };
  let reads = 0;
  await expect(
    documentFonts(
      Array.from({ length: 65 }, () => ref),
      async () => {
        reads += 1;
        return new Uint8Array();
      },
    ),
  ).rejects.toThrow("Too many");
  expect(reads).toBe(0);
});
