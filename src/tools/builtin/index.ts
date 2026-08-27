import type { ToolDefinition } from "../../core/types.js";
import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";

export function builtinTools(): ToolDefinition[] {
  return [readTool, writeTool, editTool, bashTool];
}
