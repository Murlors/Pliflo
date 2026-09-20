import { worksheetRenderWidth } from "/ooxml/xlsx-print-geometry.mjs";
import type { Worksheet } from "@silurus/ooxml/xlsx";

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
