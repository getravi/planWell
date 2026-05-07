import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

describe("PlanWell design tokens", () => {
  it("keeps the original PlanWell palette while using the dashboard shell", () => {
    const css = readFileSync("src/style.css", "utf8");

    expect(css).toContain("--surface-soft: #eef2ed");
    expect(css).toContain("--line: #dce3dc");
    expect(css).toContain("--muted: #66736a");
    expect(css).toContain("--ink: #18201c");
    expect(css).toContain("--green: #166534");
    expect(css).toContain("--blue: #1d4ed8");
    expect(css).toContain("--danger: #b42318");
  });
});
