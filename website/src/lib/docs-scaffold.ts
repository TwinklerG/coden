import path from "node:path";
import { DOC_GROUPS, type DocPage, allDocEntries as getAllDocEntries } from "../data/docs";
import { type Language, SUPPORTED_LANGUAGES } from "./site";

const NOTE_TITLE = {
  zh: "文档框架",
  en: "Documentation scaffold",
} as const;

const NOTE_BODY = {
  zh: "本页面已建立文档结构，完整内容将在后续文档任务中补充。",
  en: "This page establishes the documentation structure. Complete content will be added in a dedicated documentation task.",
} as const;

export type { DocGroup, DocPage } from "../data/docs";
export { DOC_GROUPS };

export function renderScaffold(entry: DocPage, language: Language): string {
  const localized = entry[language];

  return [
    "---",
    `title: ${localized.title}`,
    `description: ${localized.description}`,
    "sidebar:",
    `  order: ${entry.order}`,
    "---",
    "",
    `:::note[${NOTE_TITLE[language]}]`,
    NOTE_BODY[language],
    ":::",
    "",
  ].join("\n");
}

export { getAllDocEntries as allDocEntries };

export function expectedDocFiles(root: string): string[] {
  return getAllDocEntries().flatMap((entry) =>
    SUPPORTED_LANGUAGES.map((language) =>
      path.join(root, "src", "content", "docs", language, "docs", `${entry.slug}.mdx`),
    ),
  );
}
