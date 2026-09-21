import { test, expect } from "vite-plus/test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { peImports } from "./windows-pe";

test("collects normal and delay-loaded DLLs and rejects an incompatible architecture", () => {
  const root = mkdtempSync(join(tmpdir(), "pliflo-pe-"));
  try {
    const path = join(root, "fixture.exe");
    const data = Buffer.alloc(2048);
    data.writeUInt32LE(0x80, 0x3c);
    data.write("PE\0\0", 0x80);
    data.writeUInt16LE(0x8664, 0x84);
    data.writeUInt16LE(1, 0x86);
    data.writeUInt16LE(240, 0x94);
    data.writeUInt16LE(0x20b, 0x98);
    const section = 0x98 + 240;
    data.writeUInt32LE(0x1000, section + 12);
    data.writeUInt32LE(1536, section + 16);
    data.writeUInt32LE(512, section + 20);
    data.writeUInt32LE(0x1000, 0x98 + 112 + 8);
    data.writeUInt32LE(40, 0x98 + 116 + 8);
    data.writeUInt32LE(0x1100, 512 + 12);
    data.write("WINSPOOL.drv\0", 768);
    data.writeUInt32LE(0x1200, 0x98 + 112 + 13 * 8);
    data.writeUInt32LE(64, 0x98 + 116 + 13 * 8);
    data.writeUInt32LE(1, 1024);
    data.writeUInt32LE(0x1300, 1028);
    data.write("PANGO.dll\0", 1280);
    writeFileSync(path, data);
    expect(peImports(path)).toEqual(["winspool.drv", "pango.dll"]);
    data.writeUInt16LE(0x14c, 0x84);
    writeFileSync(path, data);
    expect(() => peImports(path)).toThrow("x64");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
