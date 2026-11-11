// Inline layout worker – keeps dagre off the main thread for big canvases.
import { layoutSync } from "./layout";

type Job = { id: number; nodes: Parameters<typeof layoutSync>[0]; edges: Parameters<typeof layoutSync>[1]; groups: Parameters<typeof layoutSync>[2] };

self.onmessage = (ev: MessageEvent<Job>) => {
  const { id, nodes, edges, groups } = ev.data;
  try {
    self.postMessage({ id, result: layoutSync(nodes, edges, groups ?? []) });
  } catch (e) {
    // Fall back to an error marker; the main thread re-runs synchronously.
    self.postMessage({ id, error: String(e) });
  }
};
