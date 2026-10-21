import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { ErrorBoundary, ProjectionFailed } from "./ErrorBoundary.tsx";

describe("ProjectionFailed", () => {
  const html = render(<ProjectionFailed message="Unknown model" />);

  it("says what happened, as an alert, with the error itself", () => {
    expect(html).toContain('role="alert"');
    expect(html).toContain("<strong>The projection failed.</strong>");
    expect(html).toContain('<p class="meta">Unknown model</p>');
  });

  it("offers a reload and somewhere to report it", () => {
    expect(html).toMatch(/<button type="button" class="warning-button">\s*Reload\s*<\/button>/);
    expect(html).toContain('href="https://github.com/andyscanzio/nl-predict/issues"');
  });
});

describe("ErrorBoundary", () => {
  it("keeps any thrown value as an Error to show", () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error("boom")).error.message).toBe("boom");
    expect(ErrorBoundary.getDerivedStateFromError("boom").error.message).toBe("boom");
  });

  it("renders its children while nothing has failed", () => {
    expect(render(<ErrorBoundary><p>ok</p></ErrorBoundary>)).toBe("<p>ok</p>");
  });
});
