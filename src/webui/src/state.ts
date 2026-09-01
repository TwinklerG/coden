import type {
  WebSnapshot,
  WebStateResponse,
  WebStreamEnvelope,
} from "../../web/protocol.js";

export class WebRevisionGapError extends Error {
  constructor(current: number, received: number) {
    super(
      `Web state revision gap: expected ${current + 1}, received ${received}`,
    );
    this.name = "WebRevisionGapError";
  }
}

export function applyEnvelope(
  current: WebStateResponse | undefined,
  envelope: WebStreamEnvelope,
): WebStateResponse {
  if (envelope.type === "snapshot") return envelope.data;
  if (!current) throw new WebRevisionGapError(-1, envelope.revision);
  if (envelope.revision <= current.snapshot.revision) return current;
  if (envelope.revision !== current.snapshot.revision + 1)
    throw new WebRevisionGapError(current.snapshot.revision, envelope.revision);
  const patch = envelope.data;
  let snapshot: WebSnapshot;
  if (patch.op === "append_blocks") {
    snapshot = {
      ...current.snapshot,
      blocks: [...current.snapshot.blocks, ...patch.blocks],
    };
  } else if (patch.op === "replace_blocks") {
    snapshot = { ...current.snapshot, blocks: patch.blocks };
  } else if (patch.op === "update_block") {
    const index = current.snapshot.blocks.findIndex(
      (block) => block.id === patch.id,
    );
    if (index < 0)
      throw new Error(`Web state references unknown block: ${patch.id}`);
    const blocks = [...current.snapshot.blocks];
    blocks[index] = patch.block;
    snapshot = { ...current.snapshot, blocks };
  } else {
    snapshot = { ...current.snapshot, ...patch.value };
    for (const key of patch.clear ?? []) delete snapshot[key];
  }
  return { ...current, snapshot: { ...snapshot, revision: envelope.revision } };
}
