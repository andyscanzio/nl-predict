import { describe, expect, it } from "vitest";
import { project, type Projection } from "../domain/project.ts";
import { DEFAULT_MODEL } from "../domain/projectionModels.ts";
import { splitFormRate } from "../domain/splitFormRate.ts";
import type { Snapshot } from "../domain/types.ts";
import recordedSnapshot from "../domain/__fixtures__/snapshot-2026-09-27.json";
import { projectionAnswerer, projectionClient, projectionRequest, type Picks, type ProjectionPort, type ProjectionRequest } from "./projectionRequests.ts";

const snapshot = recordedSnapshot as Snapshot;
const asOf = new Date(snapshot.snapshotAt);

describe("projectionRequest", () => {
  it("names the model by id and lists the What-If Results, so it can cross to a worker", () => {
    const request = projectionRequest({ model: splitFormRate, whatIf: new Map([["g1", "regulationWin"]]) }, asOf);
    expect(request).toEqual({ modelId: "split-form-rate", whatIf: [["g1", "regulationWin"]], now: asOf.toISOString() });
    expect(structuredClone(request)).toEqual(request);
  });
});

describe("projectionAnswerer", () => {
  const answer = projectionAnswerer(snapshot.games);

  it("projects as the page does in place, with the Post-Season", () => {
    const expected = project(snapshot.games, asOf, DEFAULT_MODEL, undefined, undefined, { postSeason: true });
    expect(answer({ modelId: DEFAULT_MODEL.id, whatIf: [], now: asOf.toISOString() })).toEqual(expected);
  });

  it("applies a What-If against the model's Real Projection", () => {
    const real = project(snapshot.games, asOf, DEFAULT_MODEL, undefined, undefined, { postSeason: true });
    const [gameId] = real.nextRound.flatMap((day) => day.games.map(({ game }) => game.id));
    const whatIf = new Map([[gameId!, "regulationLoss" as const]]);
    const expected = project(snapshot.games, asOf, DEFAULT_MODEL, whatIf, real, { postSeason: true });
    const answered = answer({ modelId: DEFAULT_MODEL.id, whatIf: [...whatIf], now: asOf.toISOString() });
    expect(answered).toEqual(expected);
    expect(answered.whatIf).toEqual(whatIf);
  });

  it("survives the trip back from a worker", () => {
    const answered = answer({ modelId: DEFAULT_MODEL.id, whatIf: [], now: asOf.toISOString() });
    expect(structuredClone(answered)).toEqual(answered);
  });
});

/** A worker stand-in that records requests and answers when told to. */
function fakePort() {
  const requests: ProjectionRequest[] = [];
  let listener: ((event: MessageEvent<Projection>) => void) | undefined;
  const port: ProjectionPort = {
    postMessage: (request) => requests.push(request),
    addEventListener: (_type, next) => (listener = next),
  };
  const reply = (label: string) => listener!({ data: { matchDay: label } as Projection } as MessageEvent<Projection>);
  return { port, requests, reply };
}

const picks = (gameId: string): Picks => ({ model: DEFAULT_MODEL, whatIf: new Map([[gameId, "regulationWin"]]) });

describe("projectionClient", () => {
  it("sends a pick and hands back its projection", () => {
    const { port, requests, reply } = fakePort();
    const answers: [Picks, string][] = [];
    const client = projectionClient(port, asOf, (picked, projection) => answers.push([picked, projection.matchDay]));
    const first = picks("a");
    client.request(first);
    expect(requests.map((request) => request.whatIf)).toEqual([[["a", "regulationWin"]]]);
    reply("A");
    expect(answers).toEqual([[first, "A"]]);
  });

  it("keeps only the newest pick made while the worker is busy, and drops the answer nobody wants any more", () => {
    const { port, requests, reply } = fakePort();
    const answers: string[] = [];
    const client = projectionClient(port, asOf, (_picked, projection) => answers.push(projection.matchDay));
    client.request(picks("a"));
    client.request(picks("b"));
    client.request(picks("c"));
    expect(requests).toHaveLength(1);
    reply("A");
    expect(answers).toEqual([]);
    expect(requests.map((request) => request.whatIf[0]![0])).toEqual(["a", "c"]);
    reply("C");
    expect(answers).toEqual(["C"]);
  });
});
