import DOMPurify from "dompurify";
import { marked } from "marked";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "blockquote",
  "ul",
  "ol",
  "li",
  "pre",
  "code",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

export function renderMarkdown(markdown: string): string {
  const escapedRawHtml = markdown
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const parsed = marked.parse(escapedRawHtml, {
    gfm: true,
    breaks: false,
    async: false,
  });
  const container = document.createElement("div");
  container.innerHTML = DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "title", "class"],
    ALLOW_DATA_ATTR: false,
  });
  for (const anchor of container.querySelectorAll("a")) {
    const href = anchor.getAttribute("href") ?? "";
    let safe = false;
    try {
      const url = new URL(href, window.location.origin);
      safe = ["http:", "https:", "mailto:"].includes(url.protocol);
    } catch {
      safe = false;
    }
    if (!safe) {
      anchor.removeAttribute("href");
      continue;
    }
    if (href.startsWith("http://") || href.startsWith("https://")) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noreferrer noopener");
    }
  }
  return container.innerHTML;
}

export function MarkdownContent({ markdown }: { markdown: string }) {
  return (
    <div
      className="markdown"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: content is escaped and DOMPurify-sanitized above.
      dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
    />
  );
}
