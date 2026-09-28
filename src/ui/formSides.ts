/** The labels for a Form Window's venue: its own Form, the other venue's Form (which an empty window borrows) and a one-letter tag. */
export const SIDES = {
  home: { form: "Home Form", other: "Away Form", letter: "H" },
  away: { form: "Away Form", other: "Home Form", letter: "A" },
} as const;
