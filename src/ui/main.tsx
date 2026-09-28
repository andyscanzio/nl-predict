import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { App } from "./App.tsx";
import { modelFromUrl, urlWithModel } from "./modelUrl.ts";
import type { ProjectionModel } from "../domain/project.ts";
import histories from "virtual:projection-history";
import snapshot from "../../data/games.json";
import type { Snapshot } from "../domain/types.ts";
import "@fontsource-variable/oxanium";
import "./styles.css";

const now = new Date();

/** Keeps the picked Projection Model in the URL, so links are shareable and Back/Forward step through picks. */
function Root() {
  const [model, setModel] = useState(() => modelFromUrl(location.href));
  useEffect(() => {
    const onPopState = () => setModel(modelFromUrl(location.href));
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);
  const pick = (next: ProjectionModel) => {
    history.pushState(null, "", urlWithModel(location.href, next));
    setModel(next);
  };
  return <App snapshot={snapshot as Snapshot} now={now} model={model} history={histories[model.id]!} onModelChange={pick} />;
}

render(<Root />, document.getElementById("app")!);
