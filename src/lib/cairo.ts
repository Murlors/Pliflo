import { encodePage, recordCanvas } from "@pliflo/canvas-recorder";

/** 只记录本次转换创建的 Canvas，不修改全局 document/Canvas 原型。 */
export function createRecordedCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  recordCanvas(canvas);
  return canvas;
}

export async function recordingPage(canvas: HTMLCanvasElement, widthPt: number, heightPt: number) {
  try {
    return await encodePage(canvas, widthPt, heightPt);
  } finally {
    canvas.width = canvas.height = 0;
  }
}
