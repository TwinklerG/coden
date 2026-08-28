import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export class TrustStore {
  constructor(private readonly file: string) {}
  async isTrusted(realPath: string): Promise<boolean> {
    return (await this.read()).includes(realPath);
  }
  async isWorkspaceTrusted(workspace: string): Promise<boolean> {
    return this.isTrusted(await realpath(workspace));
  }
  async trustWorkspace(workspace: string): Promise<void> {
    return this.trust(await realpath(workspace));
  }
  async trust(realPath: string): Promise<void> {
    const values = await this.read();
    if (!values.includes(realPath)) values.push(realPath);
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(values, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
  private async read(): Promise<string[]> {
    try {
      const value = JSON.parse(await readFile(this.file, "utf8"));
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
