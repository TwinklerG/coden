// @vitest-environment jsdom
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { PluginMarket } from "../src/components/plugins/PluginMarket";

function render(node: ReactElement) {
  const container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.append(container);
  const root = createRoot(container);
  root.render(node);
  return { container, root };
}

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("plugin market", () => {
  it("keeps a successful plugin visible when another request fails", async () => {
    const loader = vi.fn(async (name: string) =>
      name === "coden-modern-unix"
        ? { packageName: name, version: "1.0.1", compatible: true, downloads: 277 }
        : { packageName: name, compatible: false, error: "unavailable" },
    );
    render(<PluginMarket language="en" loader={loader} />);
    await nextTick();
    await nextTick();

    expect(document.body.textContent).toContain("coden-modern-unix");
    expect(document.body.textContent).toContain("Temporarily unavailable");
  });

  it("filters by package name", async () => {
    render(
      <PluginMarket
        language="en"
        loader={async (name) => ({ packageName: name, compatible: true })}
      />,
    );
    await nextTick();
    await nextTick();

    const searchbox = document.querySelector('input[type="search"]') as HTMLInputElement | null;
    expect(searchbox).not.toBeNull();
    if (!searchbox) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(searchbox, "unix");
    searchbox.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();

    expect(document.body.textContent).toContain("coden-modern-unix");
    expect(document.body.textContent).not.toContain("coden-msb");
  });
});
