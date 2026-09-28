/** The labels for a Form Window's venue: its own Form, the other venue (whose Form an empty window borrows) and a one-letter tag. */
export const SIDES = {
  home: { form: "Home form", other: "away", letter: "H" },
  away: { form: "Away form", other: "home", letter: "A" },
} as const;
