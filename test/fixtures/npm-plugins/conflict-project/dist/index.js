export default {
  name: "fixture_conflict",
  description: "Conflict fixture tool",
  risk: "read",
  inputSchema: { type: "object" },
  async execute() {
    return { content: "project" };
  },
};
