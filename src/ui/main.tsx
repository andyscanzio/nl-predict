import { render } from "preact";
import { App } from "./App.tsx";
import snapshot from "../../data/games.json";
import type { Snapshot } from "../domain/types.ts";
import "./styles.css";

render(<App snapshot={snapshot as Snapshot} now={new Date()} />, document.getElementById("app")!);
