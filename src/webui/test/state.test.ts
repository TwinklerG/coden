import { describe, expect, it } from "vitest";
import type {
  WebStateResponse,
  WebStreamEnvelope,
} from "../../web/protocol.js";
import { applyEnvelope } from "../src/state.js";

const state: WebStateResponse = {
  protocolVersion: 1,
  viewer: { clientId: "a", isOwner: true },
  snapshot: {
    revision: 4,
    phase: "idle",
    running: false,
    language: "en",
    remote: false,
    sessions: [],
    blocks: [],
    control: { ownerClientId: "a" },
    startupWarnings: [],
  },
};

describe("Web state reducer", () => {
  it("initializes from snapshots and applies ordered patches", () => {
    const snapshot: WebStreamEnvelope = {
      type: "snapshot",
      revision: 4,
      data: state,
    };
    const first = applyEnvelope(undefined, snapshot);
    const next = applyEnvelope(first, {
      type: "patch",
      revision: 5,
      data: {
        op: "append_blocks",
        blocks: [{ id: "u", kind: "user", text: "hello" }],
      },
    });
    expect(next.snapshot.blocks).toHaveLength(1);
    expect(next.snapshot.revision).toBe(5);
    expect(
      applyEnvelope(next, {
        type: "patch",
        revision: 5,
        data: { op: "merge", value: {} },
      }),
    ).toBe(next);
    expect(() =>
      applyEnvelope(next, {
        type: "patch",
        revision: 7,
        data: { op: "merge", value: {} },
      }),
    ).toThrow("revision gap");
  });

  it("rejects updates for unknown blocks and clears optional state", () => {
    expect(() =>
      applyEnvelope(state, {
        type: "patch",
        revision: 5,
        data: {
          op: "update_block",
          id: "missing",
          block: { id: "missing", kind: "info", text: "x" },
        },
      }),
    ).toThrow("unknown block");
    const withError = {
      ...state,
      snapshot: { ...state.snapshot, fatalError: { code: "x", message: "x" } },
    };
    expect(
      applyEnvelope(withError, {
        type: "patch",
        revision: 5,
        data: { op: "merge", value: {}, clear: ["fatalError"] },
      }).snapshot.fatalError,
    ).toBeUndefined();
  });
});
