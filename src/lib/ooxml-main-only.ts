/** Pliflo 依赖主线程 Canvas 录制；误用 Worker 时明确失败，不静默改变渲染路线。 */
export function createRenderWorker(): never {
  throw new Error("Pliflo requires OOXML main-thread rendering");
}
