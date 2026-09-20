// Appended to the verified 0.87.0 XLSX module; Q shares renderer metrics and caches.
// 只暴露所需宽度值，不把内部geometry对象变成业务层契约。
export function worksheetRenderWidth(sheet, columns, scale) {
  if (!Number.isInteger(columns) || columns < 1 || columns > 16384 ||
      !Number.isFinite(scale) || scale <= 0 || scale > 1) {
    throw new RangeError('Invalid worksheet width request');
  }
  return Q(sheet).roundedContentExtent(1, columns, scale, 50, 22).width;
}
