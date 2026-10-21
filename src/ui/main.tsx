import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { modelFromUrl, urlWithModel } from "./modelUrl.ts";
import { urlWithWhatIf, whatIfFromUrl } from "./whatIfUrl.ts";
import { projectionClient, type Picks } from "./projectionRequests.ts";
import type { Projection, ProjectionModel, WhatIf } from "../domain/project.ts";
import type { ProjectionModelId } from "../domain/projectionModels.ts";
import histories from "virtual:projection-history";
import snapshot from "../../data/games.json";
import type { Snapshot } from "../domain/types.ts";
import "@fontsource-variable/oxanium";
import "./styles.css";

const now = new Date();

const picksFromUrl = (): Picks => ({ model: modelFromUrl(location.href), whatIf: whatIfFromUrl(location.href) });

/** The Season Simulation's own thread; without one (or once it fails), the page projects in place. */
function startWorker(): Worker | undefined {
  try {
    return new Worker(new URL("./projectionWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return undefined;
  }
}

const worker = startWorker();

/**
 * Keeps the picked Projection Model and the What-If in the URL, so links are shareable and Back/Forward step through picks.
 * The Season Simulation runs in a worker: a pick paints as pending at once (the pressed control lit, the Headline saying
 * so) and the page stays responsive until its projection arrives.
 */
function Root() {
  const [requested, setRequested] = useState(picksFromUrl);
  const [projected, setProjected] = useState<{ picks: Picks; projection: Projection } | null>(null);
  const [inPlace, setInPlace] = useState(worker === undefined);
  const client = useMemo(
    () => worker && projectionClient(worker, now, (picks, projection) => setProjected({ picks, projection })),
    [],
  );
  useEffect(() => {
    // A worker that fails to start, throws or sends something unreadable: project in place instead.
    const onError = () => setInPlace(true);
    worker?.addEventListener("error", onError);
    worker?.addEventListener("messageerror", onError);
    const onPopState = () => setRequested(picksFromUrl());
    addEventListener("popstate", onPopState);
    return () => {
      worker?.removeEventListener("error", onError);
      worker?.removeEventListener("messageerror", onError);
      removeEventListener("popstate", onPopState);
    };
  }, []);
  useEffect(() => {
    if (!inPlace) client?.request(requested);
  }, [requested, inPlace]);
  const pick = (next: ProjectionModel<ProjectionModelId>) => {
    history.pushState(null, "", urlWithModel(location.href, next));
    setRequested((picks) => ({ ...picks, model: next }));
  };
  const changeWhatIf = (next: WhatIf, mode: "push" | "replace") => {
    if (mode === "push") history.pushState(null, "", urlWithWhatIf(location.href, next));
    else history.replaceState(null, "", urlWithWhatIf(location.href, next));
    setRequested((picks) => ({ ...picks, whatIf: next }));
  };
  // Shown: the last projected picks, or the asked-for ones while the first projection is made or when projecting in place.
  const shown = inPlace || !projected ? requested : projected.picks;
  return (
    <App
      snapshot={snapshot as Snapshot}
      now={now}
      model={shown.model}
      history={histories[shown.model.id]}
      whatIf={shown.whatIf}
      projection={inPlace ? undefined : (projected?.projection ?? null)}
      pending={shown === requested ? undefined : requested}
      onModelChange={pick}
      onWhatIfChange={changeWhatIf}
    />
  );
}

render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>,
  document.getElementById("app")!,
);
