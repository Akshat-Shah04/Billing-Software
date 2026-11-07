// Builds the PDF versions of the documentation into docs/pdf/.
//
//   cd docs/pdf-build && npm install && npm run build
//
// How it works: Markdown -> styled HTML (marked) -> PDF (headless Microsoft Edge or Google Chrome, which must be
// installed; set PDF_BROWSER to a browser's full path to choose one). Nothing is uploaded anywhere.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const outDir = path.join(root, "docs", "pdf");

// Order matters: it is the order of the combined PDF.
const DOCS = [
  { id: "overview", file: "readme.md", title: "Overview", pdf: "Billing-Software-Overview.pdf" },
  { id: "user-guide", file: "docs/user-guide.md", title: "User guide", pdf: "Billing-Software-User-Guide.pdf" },
  { id: "api", file: "docs/api.md", title: "API reference", pdf: "Billing-Software-API-Reference.pdf" },
  { id: "architecture", file: "docs/architecture.md", title: "Architecture and development", pdf: "Billing-Software-Architecture.pdf" },
  { id: "decisions", file: "docs/decisions.md", title: "Decision records", pdf: "Billing-Software-Decision-Records.pdf" },
];
const COMBINED_PDF = "Billing-Software-Documentation.pdf";
const BY_FILE = new Map(DOCS.map((d) => [path.basename(d.file).toLowerCase(), d]));

const version = JSON.parse(fs.readFileSync(path.join(root, "server", "package.json"), "utf8")).version;
const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

function findBrowser() {
  const candidates = [
    process.env.PDF_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("Microsoft Edge or Google Chrome is needed to make the PDFs. Install one, or set PDF_BROWSER to its path.");
  return found;
}

// GitHub-style heading anchors, so "## 1. Logging in" is reachable as #1-logging-in.
const slugify = (text) =>
  text.toLowerCase().replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, "").replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * Renders one Markdown file to HTML. `combined` decides what a link to another document becomes:
 * a clickable jump inside the combined PDF, or plain text in a stand-alone PDF.
 */
function renderDoc(doc, { combined }) {
  const md = fs.readFileSync(path.join(root, doc.file), "utf8");
  const prefix = combined ? `${doc.id}--` : "";
  let html = /** @type {string} */ (marked.parse(md, { gfm: true, async: false }));

  const headings = [];
  const seen = new Map();
  html = html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g, (_m, level, _attrs, inner) => {
    let slug = slugify(inner);
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    if (n) slug += `-${n}`;
    // (a document's own "Contents" heading is left out of the combined contents page)
    if (level === "2" && !/^contents$/i.test(inner.replace(/<[^>]+>/g, "").trim())) headings.push({ slug: prefix + slug, text: inner.replace(/<[^>]+>/g, "") });
    return `<h${level} id="${prefix}${slug}">${inner}</h${level}>`;
  });

  html = html.replace(/<a href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g, (_m, href, rest, text) => {
    if (/^(https?:|mailto:)/i.test(href)) return `<a href="${href}"${rest}>${text}</a>`;
    if (href.startsWith("#")) return `<a href="#${prefix}${href.slice(1)}"${rest}>${text}</a>`;
    const [file, frag] = href.split("#");
    const target = BY_FILE.get(path.basename(file).toLowerCase());
    if (target && combined) return `<a href="#${frag ? `${target.id}--${frag}` : `doc-${target.id}`}"${rest}>${text}</a>`;
    // A link to another file that does not exist inside this PDF: keep the words, drop the dead link.
    return target ? `<span class="docref">${text}</span>` : `<code class="filepath">${text}</code>`;
  });

  // ASCII diagrams use box-drawing characters and must not be re-wrapped, or they fall apart.
  html = html.replace(/<pre>([\s\S]*?)<\/pre>/g, (m, inner) => (/[─│┌┐└┘▶◀▼▲├┤┬┴┼]/.test(inner) ? `<pre class="diagram">${inner}</pre>` : m));

  return { html, headings };
}

const CSS = `
@page { size: A4; margin: 18mm 16mm 20mm; @bottom-center { content: counter(page); font: 8.5pt "Segoe UI", system-ui, sans-serif; color: #667085; } }
* { box-sizing: border-box; }
:root { --text: #14181f; --muted: #5b6474; --line: #d9dee6; --accent: #2457d6; --soft: #f3f5f9; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 10.5pt/1.55 "Segoe UI", "Segoe UI Variable Text", system-ui, Arial, sans-serif; color: var(--text); }
h1 { font-size: 22pt; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 .6em; padding-bottom: .25em; border-bottom: 2px solid var(--accent); }
h2 { font-size: 15pt; line-height: 1.3; letter-spacing: -0.01em; margin: 1.6em 0 .5em; }
h3 { font-size: 12pt; margin: 1.3em 0 .4em; }
h4 { font-size: 10.5pt; margin: 1.1em 0 .3em; }
h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
p, li { orphans: 3; widows: 3; }
p { margin: .55em 0; }
ul, ol { margin: .5em 0; padding-left: 1.5em; }
li { margin: .2em 0; }
a { color: var(--accent); text-decoration: none; }
.docref { color: var(--text); font-style: italic; }
code { font: 9.2pt Consolas, "Cascadia Mono", "Courier New", monospace; background: var(--soft); padding: .08em .35em; border-radius: 3px; overflow-wrap: anywhere; }
code.filepath { background: transparent; padding: 0; }
pre { background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: .7em .9em; margin: .8em 0; white-space: pre-wrap; overflow-wrap: anywhere; break-inside: avoid; font-size: 8.8pt; line-height: 1.45; }
pre code { background: none; padding: 0; font-size: inherit; }
pre.diagram { white-space: pre; overflow-wrap: normal; font-size: 7.2pt; line-height: 1.3; }
table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: 9.4pt; }
th, td { border: 1px solid var(--line); padding: .35em .6em; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
th { background: var(--soft); font-weight: 650; }
tr { break-inside: avoid; }
blockquote { margin: .8em 0; padding: .1em 1em; border-left: 3px solid var(--accent); color: var(--muted); }
hr { border: 0; border-top: 1px solid var(--line); margin: 1.5em 0; }
strong { font-weight: 650; }
section.doc { break-before: page; }
section.doc:first-of-type { break-before: auto; }
/* Cover and contents (combined PDF) */
.cover { min-height: 235mm; display: flex; flex-direction: column; justify-content: center; }
.cover .mark { margin-bottom: 14pt; }
.cover h1.title { font-size: 34pt; border: 0; margin: 0; padding: 0; }
.cover .sub { font-size: 16pt; color: var(--muted); margin: .2em 0 1.2em; }
.cover .meta { color: var(--muted); margin: .15em 0; }
.toc { break-before: page; }
.toc h1 { margin-bottom: .4em; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc > ol > li { margin: 1em 0 .2em; font-weight: 650; font-size: 11.5pt; }
.toc ul { list-style: none; padding-left: 1.2em; margin: .2em 0; font-weight: 400; font-size: 10pt; }
.toc ul li { margin: .12em 0; }
`;

const MARK = `<svg width="56" height="56" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="#2457d6"/><path d="M9 8.5h10M9 12.5h10M9 16.5h5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="19" cy="18.5" r="2.4" fill="#fff"/></svg>`;

const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;

function toPdf(browser, htmlPath, pdfPath, profileDir) {
  const result = spawnSync(
    browser,
    ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${profileDir}`, `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href],
    { encoding: "utf8", timeout: 180000 },
  );
  if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0) {
    throw new Error(`The browser did not produce ${path.basename(pdfPath)}.\n${result.stderr || ""}`);
  }
}

const browser = findBrowser();
console.log(`Using ${browser}`);
fs.mkdirSync(outDir, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), "billing-docs-"));
const profile = path.join(work, "profile");

try {
  // One PDF per document.
  for (const doc of DOCS) {
    const { html } = renderDoc(doc, { combined: false });
    const htmlPath = path.join(work, `${doc.id}.html`);
    fs.writeFileSync(htmlPath, page(`Billing Software: ${doc.title}`, `<section class="doc">${html}</section>`));
    toPdf(browser, htmlPath, path.join(outDir, doc.pdf), profile);
    console.log(`  ${doc.pdf}`);
  }

  // One combined PDF with a cover page and clickable contents.
  const rendered = DOCS.map((doc) => ({ doc, ...renderDoc(doc, { combined: true }) }));
  const toc = rendered
    .map(({ doc, headings }) => `<li><a href="#doc-${doc.id}">${esc(doc.title)}</a><ul>${headings.map((h) => `<li><a href="#${h.slug}">${esc(h.text)}</a></li>`).join("")}</ul></li>`)
    .join("");
  const body =
    `<section class="cover"><div class="mark">${MARK}</div><h1 class="title">Billing Software</h1><p class="sub">Documentation</p>` +
    `<p class="meta">Version ${esc(version)}</p><p class="meta">${esc(today)}</p>` +
    `<p class="meta">https://github.com/Akshat-Shah04/Billing-Software</p></section>` +
    `<section class="toc"><h1>Contents</h1><ol>${toc}</ol></section>` +
    rendered.map(({ doc, html }) => `<section class="doc" id="doc-${doc.id}">${html}</section>`).join("\n");
  const htmlPath = path.join(work, "combined.html");
  fs.writeFileSync(htmlPath, page("Billing Software: Documentation", body));
  toPdf(browser, htmlPath, path.join(outDir, COMBINED_PDF), profile);
  console.log(`  ${COMBINED_PDF}`);
  console.log(`\nWritten to ${outDir}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
