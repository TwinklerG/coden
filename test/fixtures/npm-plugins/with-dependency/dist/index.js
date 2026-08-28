import { message } from "plugin-message";

const tool = {
  name: "fixture_dependency",
  description: "Return a dependency-backed value",
  risk: "read",
  inputSchema: { type: "object" },
  async execute() {
    return { content: message };
  },
};

export default {
  apiVersion: 1,
  name: "@fixtures/with-dependency",
  tools: [tool],
};
