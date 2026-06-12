// Placeholder suite so the test pipeline is green from day one.
// Real engine suites land in Stage 2 (see prompts/stage-2-engines.md).
import { describe, expect, it } from "vitest";

describe("test pipeline", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
