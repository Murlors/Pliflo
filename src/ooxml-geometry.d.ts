// 构建时生成的扩展入口；实现与上游版本校验位于 compat/ooxml 和 scripts。
declare module "*/ooxml/xlsx-print-geometry.mjs" {
  export function worksheetRenderWidth(
    sheet: import("@silurus/ooxml/xlsx").Worksheet,
    columns: number,
    scale: number,
  ): number;
}
