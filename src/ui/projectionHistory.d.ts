declare module "virtual:projection-history" {
  import type { ProjectionHistory } from "../domain/projectionHistory.ts";

  /** The Projection History of every Projection Model, by model id; computed while the site is built (ADR 0003). */
  const histories: Record<string, ProjectionHistory>;
  export default histories;
}
