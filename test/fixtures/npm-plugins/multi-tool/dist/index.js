const first = {
  name: "fixture_first",
  description: "First fixture tool",
  risk: "read",
  inputSchema: { type: "object" },
  async execute() {
    return { content: "first" };
  },
};

const second = {
  ...first,
  name: "fixture_second",
  async execute() {
    return { content: "second" };
  },
};

export default {
  apiVersion: 1,
  name: "@fixtures/multi-tool",
  tools: [first, second],
};
