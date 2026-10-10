import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "./App.tsx";
import { modelFromUrl, urlWithModel } from "./modelUrl.ts";
import { urlWithWhatIf, whatIfFromUrl } from "./whatIfUrl.ts";
import { postSeasonFlag } from "./postSeasonFlag.ts";
import type { ProjectionModel, WhatIf } from "../domain/project.ts";
import type { ProjectionModelId } from "../domain/projectionModels.ts";
import histories from "virtual:projection-history";
import snapshot from "../../data/games.json";
import type { Snapshot } from "../domain/types.ts";
import "@fontsource-variable/oxanium";
import "./styles.css";

const now = new Date();
const postSeason = postSeasonFlag(import.meta.env.VITE_PLAYOFFS);

/** Keeps the picked Projection Model and the What-If in the URL, so links are shareable and Back/Forward step through picks. */
function Root() {
  const [model, setModel] = useState(() => modelFromUrl(location.href));
  const [whatIf, setWhatIf] = useState(() => whatIfFromUrl(location.href));
  useEffect(() => {
    const onPopState = () => {
      setModel(modelFromUrl(location.href));
      setWhatIf(whatIfFromUrl(location.href));
    };
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);
  const pick = (next: ProjectionModel<ProjectionModelId>) => {
    history.pushState(null, "", urlWithModel(location.href, next));
    setModel(next);
  };
  const changeWhatIf = (next: WhatIf, mode: "push" | "replace") => {
    if (mode === "push") history.pushState(null, "", urlWithWhatIf(location.href, next));
    else history.replaceState(null, "", urlWithWhatIf(location.href, next));
    setWhatIf(next);
  };
  return (
    <App
      snapshot={snapshot as Snapshot}
      now={now}
      model={model}
      postSeason={postSeason}
      history={histories[model.id]}
      whatIf={whatIf}
      onModelChange={pick}
      onWhatIfChange={changeWhatIf}
    />
  );
}

render(<Root />, document.getElementById("app")!);
