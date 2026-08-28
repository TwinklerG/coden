export default {
  name: "fixture_single",
  description: "Return a fixture value",
  risk: "read",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  async execute() {
    return { content: "single" };
  },
};
