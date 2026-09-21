import { worksheetRenderWidth } from "/ooxml/xlsx-print-geometry.mjs";
import type { Worksheet } from "@silurus/ooxml/xlsx";

/** Partition full columns using the same rounded geometry as the renderer. */
export function worksheetColumnPages(sheet: Worksheet, columns: number, available: number) {
  const pages: Array<{ col: number; cols: number }> = [];
  let start = 0;
  let previous = 50;
  let width = 50;
  for (let column = 1; column <= columns; column++) {
    const extent = worksheetRenderWidth(sheet, column, 1);
    const size = extent - previous;
    if (size + 50 > available) throw new Error("Worksheet column exceeds printable page width");
    if (width + size > available && column - 1 > start) {
      pages.push({ col: start, cols: column - 1 - start });
      start = column - 1;
      width = 50;
    }
    width += size;
    previous = extent;
  }
  pages.push({ col: start, cols: columns - start });
  return pages;
}

/** 使用渲染器自身的字体度量、列范围和逐列取整规则；不复制字体 fallback 或估算列宽。 */
export function fitWorksheetWidth(
  sheet: Worksheet,
  columns: number,
  pageWidth: number,
  margin: number,
): number {
  const occupied = (scale: number): number =>
    worksheetRenderWidth(sheet, columns, scale) + margin * scale;
  const available = pageWidth - margin;
  if (occupied(1) <= available) return 1;
  let low = 0,
    high = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (occupied(mid) <= available) low = mid;
    else high = mid;
  }
  return low;
}
