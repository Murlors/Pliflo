import { encodePage, recordCanvas, releaseCanvas } from "../src/recorder";

// Run in a real browser from test:rendering: mocks cannot verify toBlob timing
// or restoration of native Canvas methods after a recording is released.
export async function checkRecorderLifecycle() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  // oxlint-disable-next-line typescript/unbound-method -- compare identity, never call unbound
  const original = context.fillText;
  for (let round = 0; round < 3; round++) {
    canvas.width = 120;
    canvas.height = 80;
    const recording = recordCanvas(canvas);
    context.font = "14px Arial";
    context.fillText("Hello 中文", 2, 20);
    const source = document.createElement("canvas");
    source.width = source.height = 16;
    source.getContext("2d")!.fillRect(0, 0, 16, 16);
    context.drawImage(source, 2, 30);
    const bytes = await encodePage(canvas, 120, 80);
    const length = new DataView(bytes.buffer).getUint32(4, true);
    const data = JSON.parse(new TextDecoder().decode(bytes.slice(8, 8 + length)));
    const image = data.commands.find((command: { op: string }) => command.op === "drawImage");
    if (data.commands.length !== 2 || image.args[0].width !== 16 || image.args[0].height !== 16)
      throw new Error("Canvas snapshot lost commands/image dimensions");
    releaseCanvas(canvas);
    if (context.fillText !== original || recording.commands.length || canvas.width || canvas.height)
      throw new Error("Canvas resources or native methods were not released");
    let rejected = false;
    try {
      await encodePage(canvas, 120, 80);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Released canvas still encodes");
  }
}
