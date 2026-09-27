import { render } from "preact";
import { App } from "./App.tsx";
import { splitFormRate } from "../domain/splitFormRate.ts";
import snapshot from "../../data/games.json";
import type { Snapshot } from "../domain/types.ts";
import "@fontsource-variable/oxanium";
import "./styles.css";

render(<App snapshot={snapshot as Snapshot} now={new Date()} model={splitFormRate} />, document.getElementById("app")!);
