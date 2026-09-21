import { readFileSync } from "node:fs";

/** Read PE imports directly: no dumpbin locale parsing or developer PATH at runtime. */
export function peImports(path: string): string[] {
  const data = readFileSync(path);
  const pe = data.readUInt32LE(0x3c);
  if (data.toString("ascii", pe, pe + 4) !== "PE\0\0" || data.readUInt16LE(pe + 4) !== 0x8664)
    throw new Error(`Expected an x64 PE image: ${path}`);
  const optional = pe + 24;
  if (data.readUInt16LE(optional) !== 0x20b) throw new Error(`Expected PE32+: ${path}`);
  const sections = optional + data.readUInt16LE(pe + 20);
  const offset = (rva: number): number => {
    for (let i = 0; i < data.readUInt16LE(pe + 6); i++) {
      const section = sections + i * 40;
      const start = data.readUInt32LE(section + 12);
      const size = data.readUInt32LE(section + 16);
      if (rva >= start && rva < start + size) return data.readUInt32LE(section + 20) + rva - start;
    }
    throw new Error(`Unmapped PE RVA ${rva}: ${path}`);
  };
  const names = new Set<string>();
  for (const [directory, stride, nameOffset] of [
    [1, 20, 12],
    [13, 32, 4],
  ]) {
    const rva = data.readUInt32LE(optional + 112 + directory * 8);
    const size = data.readUInt32LE(optional + 116 + directory * 8);
    if (!rva || !size) continue;
    const start = offset(rva);
    for (let entry = start; entry + stride <= start + size; entry += stride) {
      const nameRva = data.readUInt32LE(entry + nameOffset);
      if (!nameRva) break;
      if (directory === 13 && !(data.readUInt32LE(entry) & 1))
        throw new Error(`Unsupported VA-based delay import: ${path}`);
      const nameStart = offset(nameRva),
        end = data.indexOf(0, nameStart);
      if (end < nameStart || end - nameStart > 256) throw new Error(`Invalid import: ${path}`);
      const name = data.toString("ascii", nameStart, end);
      if (!/^[\w.+-]+\.(dll|drv)$/i.test(name)) throw new Error(`Invalid DLL name: ${name}`);
      names.add(name.toLowerCase());
    }
  }
  return [...names];
}
