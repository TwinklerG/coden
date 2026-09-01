import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent, renderMarkdown } from "../src/markdown.js";

describe("safe Markdown", () => {
  it("renders useful Markdown without executing raw HTML", () => {
    render(
      <MarkdownContent
        markdown={"## Result\n\n```ts\nconst x = 1\n```\n\n- done"}
      />,
    );
    expect(screen.getByRole("heading", { name: "Result" })).toBeInTheDocument();
    expect(screen.getByText("const x = 1")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("removes executable content and hardens external links", () => {
    const html = renderMarkdown(
      "<script>alert(1)</script><img src=x onerror=alert(1)> [bad](javascript:alert(1)) [safe](https://example.com)",
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });
});
