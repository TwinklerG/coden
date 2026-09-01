import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentApplication } from "../src/cli/agent-application.js";
import type { AgentCommandOptions } from "../src/cli/agent-command.js";
import { EventBus } from "../src/core/events.js";
import { I18n } from "../src/i18n/i18n.js";
import { WebController } from "../src/web/controller.js";
import { startWebServer, type WebServerHandle } from "../src/web/server.js";
import { loadStaticAssets, resolveStaticAsset } from "../src/web/static-assets.js";
import { WebStore } from "../src/web/store.js";

const handles: WebServerHandle[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

async function assetsRoot() {
  const root = path.join(tmpdir(), `coden-web-${crypto.randomUUID()}`);
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(root, "index.html"), "<main>CodeN</main>");
  await writeFile(path.join(root, "assets", "app-123.js"), "export {};");
  await writeFile(path.join(root, "outside.txt"), "outside");
  await symlink(path.join(root, "outside.txt"), path.join(root, "linked.txt"));
  return root;
}

function application(events: EventBus, run = vi.fn(async () => undefined)) {
  return {
    runtime: { run },
    events,
    session: { sessionId: "session-1", list: async () => [] },
    recoveredMessages: [],
    startupWarnings: [],
    metadata: {
      provider: "openai",
      model: "test",
      workspace: "/tmp/work",
      workspaceId: "work",
      approvalMode: "manual",
      sessionId: "session-1",
      thinkingLevel: "default",
      thinkingDisplay: "default",
    },
    end: async () => {},
    dispose: async () => {},
  } as unknown as AgentApplication;
}

const command: AgentCommandOptions = {
  auto: false,
  smartApprove: false,
  allowOutsideWorkspace: false,
  verbose: false,
  plugin: [],
  print: false,
  tui: false,
  cli: false,
};

async function harness() {
  const root = await assetsRoot();
  const events = new EventBus();
  const run = vi.fn(async () => undefined);
  const store = new WebStore("en");
  const controller = new WebController({
    workspace: "/tmp/work",
    command,
    i18n: new I18n("en"),
    store,
    createApplication: async (options) => {
      options.onEvents?.(events);
      return application(events, run);
    },
  });
  const handle = await startWebServer({
    host: "127.0.0.1",
    port: 0,
    assetsRoot: root,
    controller,
    store,
  });
  handles.push(handle);
  await controller.bootstrap();
  return { handle, run };
}

describe("Web static assets", () => {
  it("inventories regular files without following symlinks or traversal", async () => {
    const assets = await loadStaticAssets(await assetsRoot());
    expect(resolveStaticAsset(assets, "/")?.contentType).toContain("text/html");
    expect(resolveStaticAsset(assets, "/assets/app-123.js")?.cacheControl).toContain("immutable");
    expect(resolveStaticAsset(assets, "/linked.txt")).toBeUndefined();
    expect(resolveStaticAsset(assets, "/%2e%2e/outside.txt")).toBeUndefined();
  });
});

describe("Web router", () => {
  it("serves health, assets, SSE state, and owner actions", async () => {
    const { handle, run } = await harness();
    const health = await fetch(`${handle.origin}/api/health`);
    expect(await health.json()).toEqual({ ok: true, protocolVersion: 1 });
    expect(health.headers.get("access-control-allow-origin")).toBeNull();
    expect(await (await fetch(`${handle.origin}/`)).text()).toContain("CodeN");

    const abort = new AbortController();
    const stream = await fetch(`${handle.origin}/api/events`, { signal: abort.signal });
    const cookie = stream.headers.get("set-cookie")?.split(";", 1)[0];
    const first = await stream.body?.getReader().read();
    expect(new TextDecoder().decode(first?.value)).toContain('"type":"snapshot"');
    abort.abort();

    const turn = await fetch(`${handle.origin}/api/turn`, {
      method: "POST",
      headers: {
        Cookie: cookie ?? "",
        Origin: handle.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "fix tests" }),
    });
    expect(turn.status).toBe(202);
    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects foreign origins, malformed content types, and oversized bodies", async () => {
    const { handle } = await harness();
    const stream = await fetch(`${handle.origin}/api/events`);
    const cookie = stream.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    await stream.body?.cancel();
    const foreign = await fetch(`${handle.origin}/api/turn`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(foreign.status).toBe(403);
    const wrongType = await fetch(`${handle.origin}/api/turn`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: handle.origin, "Content-Type": "text/plain" },
      body: "{}",
    });
    expect(wrongType.status).toBe(415);
    const oversized = await fetch(`${handle.origin}/api/turn`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: handle.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(1_048_576) }),
    });
    expect(oversized.status).toBe(413);
  });
});
