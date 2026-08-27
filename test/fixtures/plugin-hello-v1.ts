export default {
  name: "hello",
  description: "hello",
  risk: "read",
  inputSchema: { type: "object" },
  async execute() {
    return { content: "v1" };
  },
};
