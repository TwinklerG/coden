import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SkillDiscovery } from "../src/skills/discovery.js";
import { formatSkillCatalog, formatSkillsList } from "../src/skills/prompt.js";
import { SkillRegistry } from "../src/skills/registry.js";
import { createActivateSkillTool } from "../src/tools/builtin/activate-skill.js";

async function root(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
async function mkdtemp(prefix: string): Promise<string> {
  const { mkdtemp: make } = await import("node:fs/promises");
  return make(prefix);
}
async function skill(
  base: string,
  name: string,
  description: string,
  body = "# Full instructions\n\nUse this skill.\n",
): Promise<string> {
  const directory = path.join(base, ".agents", "skills", name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\nlicense: MIT\ncompatibility: node\nmetadata:\n  owner: test\nallowed-tools: read write\n---\n${body}`,
  );
  return directory;
}

describe("Agent Skills", () => {
  it("reports an empty registry clearly and keeps activation safely unavailable", async () => {
    const registry = new SkillRegistry();
    expect(formatSkillCatalog(registry)).toBe("");
    expect(formatSkillsList(registry)).toContain("No active skills");
    expect(
      (
        await createActivateSkillTool(registry).execute(
          { name: "missing" },
          { workspace: process.cwd(), signal: new AbortController().signal },
        )
      ).content,
    ).toContain("skill.not_found");
  });

  it("discovers valid direct children, preserves optional metadata, sorts, and projects override users", async () => {
    const workspace = await root("coden-skills-workspace-");
    const home = await root("coden-skills-home-");
    await skill(home, "zeta", "User zeta.");
    await skill(home, "shared", "User shared.");
    await skill(workspace, "alpha", "Project alpha.");
    await skill(workspace, "shared", "Project shared.");
    await mkdir(path.join(home, ".agents", "skills", "nested", "child"), { recursive: true });
    await writeFile(
      path.join(home, ".agents", "skills", "nested", "child", "SKILL.md"),
      "---\nname: child\ndescription: ignored\n---\n",
    );

    const result = await new SkillDiscovery({ workspace, home }).discover();
    expect(result.registry.list().map(({ name, scope }) => [name, scope])).toEqual([
      ["alpha", "project"],
      ["shared", "project"],
      ["zeta", "user"],
    ]);
    expect(result.registry.get("shared")).toMatchObject({
      description: "Project shared.",
      license: "MIT",
      compatibility: "node",
      metadata: { owner: "test" },
      allowedTools: "read write",
    });
  });

  it("isolates invalid metadata, oversized files, and scan-root symlink escapes", async () => {
    const workspace = await root("coden-skills-workspace-");
    const home = await root("coden-skills-home-");
    await skill(home, "valid", "Valid skill.");
    const invalid = path.join(home, ".agents", "skills", "wrong");
    await mkdir(invalid, { recursive: true });
    await writeFile(path.join(invalid, "SKILL.md"), "---\nname: different\ndescription: x\n---\n");
    const huge = await skill(home, "huge", "Huge skill.");
    await writeFile(path.join(huge, "SKILL.md"), "x".repeat(1024 * 1024 + 1));
    for (const [directoryName, frontmatter] of [
      ["Bad_Name", "name: Bad_Name\ndescription: invalid name"],
      ["empty", 'name: empty\ndescription: ""'],
      ["long", `name: long\ndescription: ${"x".repeat(1025)}`],
      ["broken", "name: [unterminated\ndescription: invalid yaml"],
    ] as const) {
      const directory = path.join(home, ".agents", "skills", directoryName);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "SKILL.md"), `---\n${frontmatter}\n---\n`);
    }
    const outside = await root("coden-skills-outside-");
    await skill(outside, "escape", "Escaped skill.");
    const outsideEntry = await skill(outside, "outside-entry", "Escaped entry.");
    await mkdir(path.join(home, ".agents", "skills"), { recursive: true });
    await symlink(
      path.join(outside, ".agents", "skills", "escape"),
      path.join(home, ".agents", "skills", "escape"),
    );
    const fileEscape = path.join(home, ".agents", "skills", "file-escape");
    await mkdir(fileEscape);
    await symlink(path.join(outsideEntry, "SKILL.md"), path.join(fileEscape, "SKILL.md"));

    const result = await new SkillDiscovery({ workspace, home }).discover();
    expect(result.registry.list().map((entry) => entry.name)).toEqual(["valid"]);
    expect(result.failures).toHaveLength(8);
    expect(result.failures.map((failure) => failure.reason).join(" ")).toContain("escapes");
  });

  it("activates only registered skills and rechecks replacement safety", async () => {
    const workspace = await root("coden-skills-workspace-");
    const home = await root("coden-skills-home-");
    const directory = await skill(home, "testing", "Use for tests.");
    const registry = (await new SkillDiscovery({ workspace, home }).discover()).registry;
    const activate = createActivateSkillTool(registry);
    const result = await activate.execute(
      { name: "testing" },
      { workspace, signal: new AbortController().signal },
    );
    expect(result.content).toContain("Skill root:");
    expect(result.content).toContain("# Full instructions");
    expect(
      (
        await activate.execute(
          { name: "missing" },
          { workspace, signal: new AbortController().signal },
        )
      ).content,
    ).toContain("skill.not_found");

    await rm(directory, { recursive: true });
    expect(
      (
        await activate.execute(
          { name: "testing" },
          { workspace, signal: new AbortController().signal },
        )
      ).content,
    ).toContain("skill.activation_failed");

    await skill(home, "testing", "Replaced skill.");
    expect(
      (
        await activate.execute(
          { name: "testing" },
          { workspace, signal: new AbortController().signal },
        )
      ).content,
    ).toContain("skill.activation_failed");
  });

  it("renders progressive catalog and a source-labelled skills list without bodies", async () => {
    const workspace = await root("coden-skills-workspace-");
    const home = await root("coden-skills-home-");
    await skill(home, "testing", "Use for tests.");
    const registry = (await new SkillDiscovery({ workspace, home }).discover()).registry;
    expect(formatSkillCatalog(registry)).toContain("- testing: Use for tests.");
    expect(formatSkillCatalog(registry)).not.toContain("# Full instructions");
    expect(formatSkillsList(registry)).toBe("testing (user): Use for tests.\n");
  });
});
