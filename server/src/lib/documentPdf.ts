import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import PDFDocument from "pdfkit";
import type { Settings } from "../routes/settings.js";
import { METHOD_LABELS, dueLine, fyLongLabel, jurisdictionLine, money, paymentLines, prettyDate, prettyTimestamp, type PaymentMethod } from "./format.js";
import type { FeesReport } from "./feesReport.js";
import type { Ledger } from "./ledger.js";
import { amountInWords } from "./words.js";

/**
 * Makes a bill or credit note as a PDF file, ready to download or send on WhatsApp.
 *
 * Text can be English, Gujarati or Hindi (Devanagari): every character is drawn with the first bundled
 * font that has it (Noto Sans, SIL Open Font License, in server/assets/fonts). A character none of them
 * has shows as a blank box rather than breaking the page.
 */

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts");
const FACE_KEYS = ["latin", "latin-ext", "devanagari", "gujarati"] as const; // tried in this order

interface Face { name: string; file: string; font: fontkit.Font }
const faceCache = new Map<number, Face[]>();

function facesFor(weight: 400 | 700): Face[] {
  let faces = faceCache.get(weight);
  if (!faces) {
    faces = FACE_KEYS.map((key) => {
      const file = path.join(FONT_DIR, `NotoSans-${key}-${weight}.woff`);
      return { name: `${key}-${weight}`, file, font: fontkit.openSync(file) as fontkit.Font };
    });
    faceCache.set(weight, faces);
  }
  return faces;
}

const INK = "#14181f";
const MUTED = "#5b6474";
const LINE = "#d9dee6";
const RED = "#c0301f";
const GREEN = "#167347";

const PAGE = { width: 595.28, height: 841.89, margin: 42 };
let CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
let BOTTOM = PAGE.height - PAGE.margin - 8; // content stops here; the footer line sits below it (at height - 30)

/** A4 portrait (bills, ledgers) or landscape (the fees report, which has many columns). */
function setLayout(layout: "portrait" | "landscape") {
  const [w, h] = layout === "landscape" ? [841.89, 595.28] : [595.28, 841.89];
  PAGE.width = w;
  PAGE.height = h;
  CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
  BOTTOM = PAGE.height - PAGE.margin - 8;
}

interface Run { text: string; face: Face }

/** Splits text into runs, each drawn with a font that has its characters. */
function runsOf(text: string, bold: boolean): Run[] {
  const faces = facesFor(bold ? 700 : 400);
  const out: Run[] = [];
  for (const ch of text.normalize("NFC").replace(/\t/g, " ").replace(/[\u0000-\u0008\u000b-\u001f]/g, "")) {
    const cp = ch.codePointAt(0)!;
    // Spaces, joiners and combining marks stay with the font of the character before them.
    const sticky = cp === 0x20 || cp === 0x200c || cp === 0x200d || (cp >= 0x300 && cp <= 0x36f);
    const face = sticky && out.length ? out[out.length - 1].face : (faces.find((f) => f.font.hasGlyphForCodePoint(cp)) ?? faces[0]);
    if (out.length && out[out.length - 1].face === face) out[out.length - 1].text += ch;
    else out.push({ text: ch, face });
  }
  return out;
}

type Doc = InstanceType<typeof PDFDocument>;

class Pen {
  y = PAGE.margin;
  constructor(readonly doc: Doc) {
    for (const weight of [400, 700] as const) for (const f of facesFor(weight)) doc.registerFont(f.name, f.file);
  }

  width(text: string, size: number, bold = false): number {
    let w = 0;
    for (const r of runsOf(text, bold)) w += this.doc.font(r.face.name).fontSize(size).widthOfString(r.text);
    return w;
  }

  /** Greedy word wrap to a width; a single word longer than the width is broken by characters. */
  lines(text: string, size: number, bold: boolean, maxWidth: number): string[] {
    const out: string[] = [];
    for (const paragraph of String(text ?? "").split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(" ")) {
        const trial = line ? `${line} ${word}` : word;
        if (this.width(trial, size, bold) <= maxWidth) {
          line = trial;
          continue;
        }
        if (line) out.push(line);
        line = "";
        let chunk = "";
        for (const ch of word) {
          if (chunk && this.width(chunk + ch, size, bold) > maxWidth) {
            out.push(chunk);
            chunk = "";
          }
          chunk += ch;
        }
        line = chunk;
      }
      out.push(line);
    }
    return out;
  }

  /** Draws one line of text at (x, y). align "right" treats x as the right edge. */
  draw(text: string, x: number, y: number, o: { size: number; bold?: boolean; color?: string; align?: "left" | "right" | "center"; width?: number }): void {
    const bold = o.bold ?? false;
    const total = this.width(text, o.size, bold);
    let cx = o.align === "right" ? x - total : o.align === "center" ? x + ((o.width ?? 0) - total) / 2 : x;
    for (const r of runsOf(text, bold)) {
      this.doc.font(r.face.name).fontSize(o.size).fillColor(o.color ?? INK).text(r.text, cx, y, { lineBreak: false });
      cx += this.doc.widthOfString(r.text);
    }
  }

  /** Wrapped paragraph at the current y. Returns the height used. */
  paragraph(text: string, x: number, maxWidth: number, o: { size: number; bold?: boolean; color?: string; gap?: number }): number {
    const lh = o.size * 1.35;
    const ls = this.lines(text, o.size, o.bold ?? false, maxWidth);
    ls.forEach((l, i) => this.draw(l, x, this.y + i * lh, { size: o.size, bold: o.bold, color: o.color }));
    this.y += ls.length * lh + (o.gap ?? 0);
    return ls.length * lh;
  }

  /** Starts a new page when the next block would not fit. Returns true if it did. */
  ensure(height: number, onNewPage?: () => void): boolean {
    if (this.y + height <= BOTTOM) return false;
    this.doc.addPage();
    this.y = PAGE.margin;
    onNewPage?.();
    return true;
  }

  rule(y: number, x1 = PAGE.margin, x2 = PAGE.width - PAGE.margin, color = LINE, w = 0.6): void {
    this.doc.moveTo(x1, y).lineTo(x2, y).lineWidth(w).strokeColor(color).stroke();
  }
}

interface Logo { contentType: string; data: Buffer }

/** Lines of text centred across the page, wrapped to the content width. */
function centred(pen: Pen, text: string, o: { size: number; bold?: boolean; color?: string; gap?: number }) {
  const lh = o.size * 1.3;
  for (const paragraph of String(text).split(/\r?\n/)) {
    for (const l of pen.lines(paragraph, o.size, o.bold ?? false, CONTENT_WIDTH)) {
      pen.draw(l, PAGE.margin, pen.y, { size: o.size, bold: o.bold, color: o.color, align: "center", width: CONTENT_WIDTH });
      pen.y += lh;
    }
  }
  pen.y += o.gap ?? 0;
}

/** The firm's letterhead, centred: logo, name, the line under it, address, mobile and GSTIN. */
function letterhead(pen: Pen, org: Settings, logo: Logo | null) {
  const { doc } = pen;
  if (logo) {
    try {
      const img = (doc as unknown as { openImage(b: Buffer): { width: number; height: number } }).openImage(logo.data);
      const scale = Math.min(170 / img.width, 56 / img.height, 1);
      const w = img.width * scale;
      doc.image(logo.data, (PAGE.width - w) / 2, pen.y, { width: w });
      pen.y += img.height * scale + 8;
    } catch {
      /* an unreadable logo is skipped rather than failing the whole document */
    }
  }
  centred(pen, org.org_name || "Bill", { size: 18, bold: true, gap: 1 });
  if (org.org_tagline) centred(pen, org.org_tagline.toUpperCase(), { size: 8.5, bold: true, color: MUTED, gap: 3 });
  if (org.org_address) centred(pen, org.org_address, { size: 9, color: INK });
  const contact = [org.org_mobile && `Mobile: ${org.org_mobile}`, org.org_gstin && `GSTIN: ${org.org_gstin}`].filter(Boolean).join("     ");
  if (contact) centred(pen, contact, { size: 9, bold: true });
  pen.y += 8;
  pen.rule(pen.y, PAGE.margin, PAGE.width - PAGE.margin, INK, 1);
  pen.y += 14;
}

/** "To" the client on the left; the document title and its numbers in a box on the right. */
function partyAndTitle(
  pen: Pen,
  d: any,
  title: string,
  rows: [string, string][],
  tag?: { text: string; color: string },
) {
  const top = pen.y;
  const boxW = 210;
  const boxX = PAGE.width - PAGE.margin - boxW;
  const leftW = boxX - PAGE.margin - 18;

  // Left: the client.
  pen.draw("TO", PAGE.margin, pen.y, { size: 7.5, bold: true, color: MUTED });
  pen.y += 12;
  pen.paragraph(d.client_name, PAGE.margin, leftW, { size: 12, bold: true, gap: 1 });
  if (d.client_address) pen.paragraph(d.client_address, PAGE.margin, leftW, { size: 9 });
  if (d.client_city) pen.paragraph(d.client_city, PAGE.margin, leftW, { size: 9 });
  const ids = [d.client_pan && `PAN: ${d.client_pan}`, d.client_gstin && `GSTIN: ${d.client_gstin}`].filter(Boolean).join("     ");
  if (ids) pen.paragraph(ids, PAGE.margin, leftW, { size: 9, bold: true });
  if (d.client_phone) pen.paragraph(`Mobile: ${d.client_phone}`, PAGE.margin, leftW, { size: 9, color: MUTED });
  const leftEnd = pen.y;

  // Right: title and numbers, boxed.
  const padding = 10;
  const rowH = 15;
  const boxH = padding + 18 + rows.length * rowH + padding - 4;
  pen.doc.roundedRect(boxX, top, boxW, boxH, 5).lineWidth(0.9).strokeColor("#aab2c0").stroke();
  pen.draw(title, boxX, top + padding, { size: 12.5, bold: true, align: "center", width: boxW });
  let ry = top + padding + 22;
  for (const [label, value] of rows) {
    pen.draw(label, boxX + padding, ry, { size: 9, color: MUTED });
    pen.draw(value, boxX + boxW - padding, ry, { size: 9.5, bold: true, align: "right" });
    ry += rowH;
  }
  let boxEnd = top + boxH;
  if (tag) {
    pen.draw(tag.text, boxX + boxW, boxEnd + 6, { size: 10, bold: true, color: tag.color, align: "right" });
    boxEnd += 22;
  }
  pen.y = Math.max(leftEnd, boxEnd) + 16;
}

/** Sr. | Particulars | Year | Amount. A quantity is shown under the description only when it is more than one. */
function itemsTable(pen: Pen, items: any[], o: { heading: string; year: boolean }) {
  const right = PAGE.width - PAGE.margin;
  const xAmount = right;
  const amountW = 100;
  const yearW = o.year ? 92 : 0;
  const xYear = xAmount - amountW; // right edge of the year column
  const srW = 26;
  const xText = PAGE.margin + srW;
  const textW = xYear - yearW - xText - 10;

  const head = () => {
    pen.draw("SR.", PAGE.margin, pen.y, { size: 7.5, bold: true, color: MUTED });
    pen.draw(o.heading.toUpperCase(), xText, pen.y, { size: 7.5, bold: true, color: MUTED });
    if (o.year) pen.draw("YEAR", xYear - 6, pen.y, { size: 7.5, bold: true, color: MUTED, align: "right" });
    pen.draw("AMOUNT (₹)", xAmount, pen.y, { size: 7.5, bold: true, color: MUTED, align: "right" });
    pen.y += 13;
    pen.rule(pen.y, PAGE.margin, right, INK, 0.9);
    pen.y += 8;
  };
  head();

  items.forEach((it, n) => {
    const titleLines = pen.lines(it.description, 11, true, textW);
    const extra = [it.details, it.quantity > 1 ? `${it.quantity} × ${money(it.unit_price_paise)}` : ""].filter(Boolean).join("\n");
    const detailLines = extra ? pen.lines(extra, 8.5, false, textW) : [];
    const height = titleLines.length * 14.5 + (detailLines.length ? 3 + detailLines.length * 11.5 : 0) + 10;
    pen.ensure(height + 4, head);
    pen.draw(String(n + 1), PAGE.margin, pen.y + 1, { size: 10 });
    titleLines.forEach((l, k) => pen.draw(l, xText, pen.y + k * 14.5, { size: 11, bold: true }));
    detailLines.forEach((l, k) => pen.draw(l, xText, pen.y + titleLines.length * 14.5 + 3 + k * 11.5, { size: 8.5, color: MUTED }));
    if (o.year && it.fy_start) pen.draw(fyLongLabel(it.fy_start), xYear - 6, pen.y + 1.5, { size: 9.5, align: "right" });
    pen.draw(money(it.line_total_paise), xAmount, pen.y + 1.5, { size: 10, bold: true, align: "right" });
    pen.y += height;
    pen.rule(pen.y - 5);
  });
  pen.y += 6;
}

/** The total in words on the left and "E.& O.E." on the right, under the totals. */
function inWords(pen: Pen, paise: number) {
  const words = amountInWords(paise);
  const lines = pen.lines(words, 10, true, CONTENT_WIDTH - 90);
  pen.ensure(16 + lines.length * 13.5);
  pen.draw("AMOUNT IN WORDS", PAGE.margin, pen.y, { size: 7.5, bold: true, color: MUTED });
  pen.draw("E.& O.E.", PAGE.width - PAGE.margin, pen.y, { size: 8.5, bold: true, color: MUTED, align: "right" });
  pen.y += 12;
  lines.forEach((l, k) => pen.draw(l, PAGE.margin, pen.y + k * 13.5, { size: 10, bold: true }));
  pen.y += lines.length * 13.5 + 12;
}

/** Remarks: the due date and any notes. */
function remarks(pen: Pen, lines: string[]) {
  const text = lines.filter(Boolean).join("\n");
  if (!text) return;
  pen.ensure(40);
  pen.draw("REMARKS", PAGE.margin, pen.y, { size: 7.5, bold: true, color: MUTED });
  pen.y += 12;
  pen.paragraph(text, PAGE.margin, CONTENT_WIDTH, { size: 9.5, gap: 10 });
}

/**
 * "For, <firm>" with room to sign and the signatory's name on the right, the firm's state on the left.
 * (The jurisdiction line goes in the footer of the last page, so this block stays compact.)
 */
function signOff(pen: Pen, org: Settings) {
  pen.ensure(66);
  pen.y += 2;
  const right = PAGE.width - PAGE.margin;
  const top = pen.y;
  pen.draw(`For, ${org.org_name || "the firm"}`, right, top, { size: 10, bold: true, align: "right" });
  const signY = top + 36; // room for the signature
  pen.rule(signY - 4, right - 170, right, "#aab2c0", 0.7);
  pen.draw(org.signatory_name || "Authorised Signatory", right, signY, { size: 9.5, bold: !!org.signatory_name, align: "right" });
  if (org.signatory_name) pen.draw("Authorised Signatory", right, signY + 13, { size: 8, color: MUTED, align: "right" });
  if (org.org_state) pen.draw(`State: ${org.org_state}`, PAGE.margin, signY, { size: 9.5, bold: true });
  pen.y = signY + 26;
}

function totals(pen: Pen, rows: { label: string; value: string; strong?: boolean; color?: string }[]) {
  const right = PAGE.width - PAGE.margin;
  const x = right - 250;
  pen.ensure(rows.length * 17 + 10);
  for (const r of rows) {
    if (r.strong) {
      pen.rule(pen.y - 2, x, right, INK, 1.2);
      pen.y += 3;
    }
    const size = r.strong ? 12.5 : 10;
    pen.draw(r.label, x, pen.y, { size, bold: r.strong, color: r.color });
    pen.draw(r.value, right, pen.y, { size, bold: r.strong, color: r.color, align: "right" });
    pen.y += r.strong ? 22 : 16;
  }
  pen.y += 4;
}

function section(pen: Pen, title: string, rows: string[][], widths: number[], aligns: ("left" | "right")[]) {
  pen.ensure(30 + rows.length * 14);
  pen.draw(title.toUpperCase(), PAGE.margin, pen.y, { size: 7.5, bold: true, color: MUTED });
  pen.y += 13;
  for (const r of rows) {
    let x = PAGE.margin;
    r.forEach((cell, n) => {
      const w = widths[n];
      const text = fitText(pen, cell, w - 6);
      if (aligns[n] === "right") pen.draw(text, x + w, pen.y, { size: 9, align: "right" });
      else pen.draw(text, x, pen.y, { size: 9 });
      x += w;
    });
    pen.y += 14;
  }
  pen.y += 8;
}

/** Shortens text with "..." so it fits one line of a given width. */
function fitText(pen: Pen, text: string, width: number): string {
  if (pen.width(text, 9) <= width) return text;
  let t = text;
  while (t.length > 1 && pen.width(`${t}...`, 9) > width) t = t.slice(0, -1);
  return `${t}...`;
}

function paymentBox(pen: Pen, org: Settings) {
  const lines = paymentLines(org);
  if (!lines.length && !org.payment_instructions) return;
  const instructions = org.payment_instructions ? pen.lines(org.payment_instructions, 9, false, CONTENT_WIDTH - 24) : [];
  const height = 26 + lines.length * 14 + (instructions.length ? 6 + instructions.length * 12.2 : 0) + 10;
  pen.ensure(height + 6);
  const top = pen.y;
  pen.doc.roundedRect(PAGE.margin, top, CONTENT_WIDTH, height, 5).lineWidth(0.8).strokeColor("#aab2c0").stroke();
  pen.draw("PAYMENT DETAILS: PLEASE PAY TO", PAGE.margin + 12, top + 10, { size: 7.5, bold: true, color: MUTED });
  let y = top + 26;
  for (const [k, v] of lines) {
    pen.draw(k, PAGE.margin + 12, y, { size: 9, color: MUTED });
    pen.draw(v, PAGE.margin + 110, y, { size: 9.5, bold: true });
    y += 14;
  }
  if (instructions.length) {
    y += 6;
    instructions.forEach((l, n) => pen.draw(l, PAGE.margin + 12, y + n * 12.2, { size: 9 }));
  }
  pen.y = top + height + 12;
}

/** Page numbers, a faint stamp on cancelled bills, the document number on every page, and a centred line on the last page. */
function decoratePages(pen: Pen, docLabel: string, stamp: string | null, lastPageNote = "") {
  const { doc } = pen;
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // writing in the bottom margin would otherwise start a new page
    if (stamp) {
      doc.save();
      doc.rotate(-24, { origin: [PAGE.width / 2, PAGE.height / 2] });
      doc.fillOpacity(0.13);
      pen.draw(stamp, PAGE.width / 2 - 200, PAGE.height / 2 - 40, { size: 96, bold: true, color: RED, align: "center", width: 400 });
      doc.fillOpacity(1);
      doc.restore();
    }
    pen.draw(docLabel, PAGE.margin, PAGE.height - 30, { size: 8, color: MUTED });
    pen.draw(`Page ${i + 1} of ${range.count}`, PAGE.width - PAGE.margin, PAGE.height - 30, { size: 8, color: MUTED, align: "right" });
    if (lastPageNote && i === range.count - 1) {
      pen.draw(lastPageNote, PAGE.margin, PAGE.height - 30, { size: 8.5, bold: true, color: INK, align: "center", width: CONTENT_WIDTH });
    }
  }
}

function build(
  title: string,
  author: string,
  draw: (pen: Pen) => { footer: string; stamp: string | null; note?: string },
  layout: "portrait" | "landscape" = "portrait",
): Promise<Buffer> {
  setLayout(layout);
  const doc = new PDFDocument({ size: "A4", layout, margin: PAGE.margin, bufferPages: true, info: { Title: title, Author: author || "Billing Software" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const pen = new Pen(doc);
  try {
    const { footer, stamp, note } = draw(pen);
    decoratePages(pen, footer, stamp, note);
  } finally {
    setLayout("portrait");
  }
  doc.end();
  return done;
}

export function renderBillPdf(bill: any, org: Settings, logo: Logo | null): Promise<Buffer> {
  const cancelled = bill.status === "cancelled";
  return build(`Bill ${bill.bill_no}`, org.org_name, (pen) => {
    letterhead(pen, org, logo);
    partyAndTitle(
      pen,
      bill,
      "PROFESSIONAL INVOICE",
      [
        ["Bill No.", bill.bill_no],
        ["Date", prettyDate(bill.bill_date)],
        ...(bill.client_file_no ? ([["File No.", bill.client_file_no]] as [string, string][]) : []),
      ],
      cancelled ? { text: "CANCELLED", color: RED } : bill.state === "paid" ? { text: "PAID", color: GREEN } : undefined,
    );
    const fees = bill.items.filter((i: any) => i.kind !== "reimbursement");
    const onBehalf = bill.items.filter((i: any) => i.kind === "reimbursement");
    if (fees.length) itemsTable(pen, fees, { heading: "Being the charges for services rendered", year: true });
    if (onBehalf.length) itemsTable(pen, onBehalf, { heading: "Paid on your behalf (no GST)", year: false });

    const rows: Parameters<typeof totals>[1] = [];
    if (bill.gst_rate_percent > 0 || bill.reimbursement_paise > 0) rows.push({ label: "Fees", value: money(bill.subtotal_paise) });
    if (bill.gst_rate_percent > 0) rows.push({ label: `GST @ ${bill.gst_rate_percent}% (on fees)`, value: money(bill.gst_paise) });
    if (bill.reimbursement_paise > 0) rows.push({ label: "Paid on your behalf", value: money(bill.reimbursement_paise) });
    rows.push({ label: bill.reimbursement_paise > 0 ? "Total payable" : "Total", value: money(bill.total_paise), strong: true });
    totals(pen, rows);
    inWords(pen, bill.total_paise);

    // What has happened since the bill was issued (only when something has).
    if (bill.credited_paise > 0 || bill.paid_paise > 0 || bill.discount_paise > 0) {
      const after: Parameters<typeof totals>[1] = [];
      if (bill.credited_paise > 0) after.push({ label: "Credit notes", value: `- ${money(bill.credited_paise)}` });
      if (bill.paid_paise > 0) after.push({ label: "Paid", value: `- ${money(bill.paid_paise)}` });
      if (bill.discount_paise > 0) after.push({ label: "Discount", value: `- ${money(bill.discount_paise)}` });
      after.push({ label: "Balance due", value: money(bill.balance_paise), strong: true });
      totals(pen, after);
    }

    if (cancelled) {
      pen.ensure(40);
      pen.paragraph(`This bill was cancelled on ${prettyTimestamp(bill.cancelled_at)}${bill.cancelled_by_name ? ` by ${bill.cancelled_by_name}` : ""}: ${bill.cancel_reason}`, PAGE.margin, CONTENT_WIDTH, { size: 9.5, color: RED, gap: 8 });
    }
    remarks(pen, [cancelled ? "" : dueLine(bill.due_date), bill.notes ?? ""]);

    const payments = (bill.payments ?? []).filter((p: any) => !p.voided_at);
    if (payments.length) {
      section(pen, "Payments received", payments.map((p: any) => [prettyDate(p.paid_on), `${METHOD_LABELS[p.method as PaymentMethod] ?? p.method}${p.reference ? ` - ${p.reference}` : ""}`, money(p.amount_paise)]), [90, CONTENT_WIDTH - 90 - 110, 110], ["left", "left", "right"]);
    }
    if ((bill.credit_notes ?? []).length) {
      section(pen, "Credit notes", bill.credit_notes.map((c: any) => [c.cn_no, prettyDate(c.cn_date), money(c.total_paise)]), [150, CONTENT_WIDTH - 150 - 110, 110], ["left", "left", "right"]);
    }
    if (!cancelled) paymentBox(pen, org);
    signOff(pen, org);
    return { footer: bill.bill_no, stamp: cancelled ? "CANCELLED" : null, note: jurisdictionLine(org) };
  });
}

export function renderCreditNotePdf(cn: any, org: Settings, logo: Logo | null): Promise<Buffer> {
  return build(`Credit note ${cn.cn_no}`, org.org_name, (pen) => {
    letterhead(pen, org, logo);
    partyAndTitle(pen, cn, "CREDIT NOTE", [
      ["Credit note No.", cn.cn_no],
      ["Date", prettyDate(cn.cn_date)],
      ["Against bill", cn.bill_no],
      ["Bill date", prettyDate(cn.bill_date)],
      ...(cn.client_file_no ? ([["File No.", cn.client_file_no]] as [string, string][]) : []),
    ]);
    itemsTable(pen, cn.items, { heading: "Particulars", year: false });
    const rows: Parameters<typeof totals>[1] = [];
    if (cn.gst_rate_percent > 0) {
      rows.push({ label: "Subtotal", value: money(cn.subtotal_paise) });
      rows.push({ label: `GST @ ${cn.gst_rate_percent}%`, value: money(cn.gst_paise) });
    }
    rows.push({ label: "Credit total", value: money(cn.total_paise), strong: true });
    totals(pen, rows);
    inWords(pen, cn.total_paise);
    remarks(pen, [`Reason: ${cn.reason}`, `This credit note reduces the amount due on bill ${cn.bill_no}.`]);
    signOff(pen, org);
    return { footer: cn.cn_no, stamp: null, note: jurisdictionLine(org) };
  });
}

/* ====================================================================== */
/* Tables for the ledger and the fees report                               */
/* ====================================================================== */

interface Column { label: string; width: number; align?: "left" | "right"; /** wrap long text onto more lines instead of shortening it */ wrap?: boolean }

/** A simple table: header row (repeated on every new page), rows that shorten text to fit, and bold rows. */
function grid(pen: Pen, cols: Column[], rows: { cells: string[]; bold?: boolean; muted?: boolean; rule?: boolean }[], size = 8.5) {
  const scale = CONTENT_WIDTH / cols.reduce((s, c) => s + c.width, 0); // widths are proportions of the page width
  const widths = cols.map((c) => c.width * scale);
  const lh = size + 6;
  const head = () => {
    let x = PAGE.margin;
    cols.forEach((c, n) => {
      const w = widths[n];
      if (c.align === "right") pen.draw(c.label.toUpperCase(), x + w - 4, pen.y, { size: 7, bold: true, color: MUTED, align: "right" });
      else pen.draw(c.label.toUpperCase(), x + 2, pen.y, { size: 7, bold: true, color: MUTED });
      x += w;
    });
    pen.y += 11;
    pen.rule(pen.y, PAGE.margin, PAGE.width - PAGE.margin, INK, 0.9);
    pen.y += 5;
  };
  head();
  const lineH = size * 1.3;
  for (const r of rows) {
    // Wrapped columns may take several lines; the row is as tall as its tallest cell.
    const cellLines = r.cells.map((cell, n) => (cols[n].wrap ? pen.lines(cell, size, !!r.bold, widths[n] - 6) : [fitTextAt(pen, cell, widths[n] - 6, size, !!r.bold)]));
    const lines = Math.max(1, ...cellLines.map((l) => l.length));
    const rowH = lh + (lines - 1) * lineH;
    pen.ensure(rowH + 2, head);
    if (r.rule) {
      pen.rule(pen.y - 2, PAGE.margin, PAGE.width - PAGE.margin, INK, 0.7);
      pen.y += 2;
    }
    let x = PAGE.margin;
    cellLines.forEach((ls, n) => {
      const w = widths[n];
      const o = { size, bold: r.bold, color: r.muted ? MUTED : INK };
      ls.forEach((text, k) => {
        if (cols[n].align === "right") pen.draw(text, x + w - 4, pen.y + k * lineH, { ...o, align: "right" });
        else pen.draw(text, x + 2, pen.y + k * lineH, o);
      });
      x += w;
    });
    pen.y += rowH;
    if (!r.rule) pen.rule(pen.y - 4, PAGE.margin, PAGE.width - PAGE.margin, "#eceff3", 0.5);
  }
  pen.y += 6;
}

function fitTextAt(pen: Pen, text: string, width: number, size: number, bold: boolean): string {
  if (pen.width(text, size, bold) <= width) return text;
  let t = text;
  while (t.length > 1 && pen.width(`${t}...`, size, bold) > width) t = t.slice(0, -1);
  return `${t}...`;
}

/** A centred title block under the letterhead: e.g. "LEDGER ACCOUNT", with lines of detail. */
function titleBlock(pen: Pen, title: string, lines: string[]) {
  pen.draw(title, PAGE.margin, pen.y, { size: 13, bold: true, align: "center", width: CONTENT_WIDTH });
  pen.y += 18;
  for (const l of lines) {
    pen.draw(l, PAGE.margin, pen.y, { size: 9, color: MUTED, align: "center", width: CONTENT_WIDTH });
    pen.y += 12;
  }
  pen.y += 8;
}

/** Label / value pairs in up to three columns (the summary of a report). */
function figures(pen: Pen, items: [string, string][], perRow = 3) {
  const w = CONTENT_WIDTH / perRow;
  const rows = Math.ceil(items.length / perRow);
  pen.ensure(rows * 30 + 10);
  items.forEach(([label, value], n) => {
    const x = PAGE.margin + (n % perRow) * w;
    const y = pen.y + Math.floor(n / perRow) * 30;
    pen.draw(label.toUpperCase(), x, y, { size: 7, bold: true, color: MUTED });
    pen.draw(value, x, y + 10, { size: 11, bold: true });
  });
  pen.y += rows * 30 + 6;
}

/** "18,000.00": Indian grouping, two decimals, no rupee sign (as on the firm's statements). Negative = in the client's favour. */
const amt = (paise: number) => {
  const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(paise) / 100);
  return paise < 0 ? `${s} Cr` : s;
};
/** "2026-11-06" -> "06/11/2026" */
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** ["A", "B", "C"] -> "A, B and C" */
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * The statement of account sent to a client (or a family group), laid out like the firm's own statement:
 * letterhead, "STATEMENT OF ACCOUNT AS ON <date>", "To: <name> (<members>)", Date / Particulars / Bill-Ref / Debit /
 * Credit / Balance with a Total and the OUTSTANDING BALANCE, the bills still pending (receipts applied to the oldest
 * bill first), and a closing request with the bank details.
 */
export function renderLedgerPdf(l: Ledger, org: Settings, logo: Logo | null): Promise<Buffer> {
  return build(`Statement of account ${l.name}`, org.org_name, (pen) => {
    letterhead(pen, org, logo);
    pen.draw(`STATEMENT OF ACCOUNT AS ON ${dmy(l.to)}`, PAGE.margin, pen.y, { size: 12.5, bold: true, align: "center", width: CONTENT_WIDTH });
    pen.y += 16;
    if (l.from > l.first_date) {
      pen.draw(`For the period ${dmy(l.from)} to ${dmy(l.to)}`, PAGE.margin, pen.y, { size: 8.5, color: MUTED, align: "center", width: CONTENT_WIDTH });
      pen.y += 12;
    }
    pen.y += 6;
    const to = l.kind === "group" && l.members.length ? `${l.name} (${andList(l.members)})` : l.name;
    pen.ensure(30);
    pen.draw("To:", PAGE.margin, pen.y, { size: 10, bold: true });
    const toLines = pen.lines(to, 10, false, CONTENT_WIDTH - 22);
    toLines.forEach((t, n) => pen.draw(t, PAGE.margin + 22, pen.y + n * 13.5, { size: 10 }));
    pen.y += toLines.length * 13.5;
    if (l.client) {
      const parts = [l.client.address?.replace(/\s*\n\s*/g, ", "), l.client.city, l.client.pan && `PAN: ${l.client.pan}`, l.client.file_no && `File No.: ${l.client.file_no}`].filter(Boolean);
      if (parts.length) pen.paragraph(parts.join("   "), PAGE.margin + 22, CONTENT_WIDTH - 22, { size: 8.5, color: MUTED });
    }
    pen.y += 10;

    const rows: { cells: string[]; bold?: boolean; muted?: boolean; rule?: boolean }[] = [];
    if (l.opening_paise !== 0 || l.from > l.first_date) {
      rows.push({ cells: [dmy(l.from), "Opening balance", "", "", "", amt(l.opening_paise)], bold: true });
    }
    for (const e of l.entries) {
      rows.push({ cells: [dmy(e.date), e.particulars, e.ref, e.debit_paise ? amt(e.debit_paise) : "", e.credit_paise ? amt(e.credit_paise) : "", amt(e.balance_paise)] });
    }
    if (!l.entries.length) rows.push({ cells: ["", "No transactions in this period", "", "", "", ""], muted: true });
    const debits = l.entries.reduce((s, e) => s + e.debit_paise, 0);
    const credits = l.entries.reduce((s, e) => s + e.credit_paise, 0);
    rows.push({ cells: ["", "Total", "", amt(debits), amt(credits), ""], bold: true, rule: true });
    rows.push({ cells: ["", l.closing_paise < 0 ? "BALANCE IN YOUR FAVOUR" : "OUTSTANDING BALANCE", "", "", "", amt(Math.abs(l.closing_paise))], bold: true, rule: true });
    grid(pen, [
      { label: "Date", width: 64 },
      { label: "Particulars", width: 230, wrap: true },
      { label: "Bill / Ref", width: 74 },
      { label: "Debit", width: 74, align: "right" },
      { label: "Credit", width: 74, align: "right" },
      { label: "Balance", width: 80, align: "right" },
    ], rows, 8.5);

    if (l.pending.length) {
      pen.ensure(60);
      pen.draw("Bills pending (receipts applied oldest bill first)", PAGE.margin, pen.y, { size: 9, bold: true });
      pen.y += 14;
      const t = l.pending.reduce((s, p) => ({ billed: s.billed + p.billed_paise, received: s.received + p.received_paise, pending: s.pending + p.pending_paise }), { billed: 0, received: 0, pending: 0 });
      grid(pen, [
        { label: "Bill No.", width: 90 },
        { label: "Party", width: 210, wrap: true },
        { label: "Billed", width: 90, align: "right" },
        { label: "Received", width: 90, align: "right" },
        { label: "Pending", width: 90, align: "right" },
      ], [
        ...l.pending.map((p) => ({ cells: [p.bill_no, p.client_name, amt(p.billed_paise), amt(p.received_paise), amt(p.pending_paise)] })),
        { cells: ["Total", "", amt(t.billed), amt(t.received), amt(t.pending)], bold: true, rule: true },
      ], 8.5);
    }

    // The closing request, with where to pay.
    const bank = [
      org.bank_account_number && `A/c No. ${org.bank_account_number}`,
      org.bank_name,
      org.bank_ifsc && `IFSC ${org.bank_ifsc}`,
    ].filter(Boolean).join(", ");
    const how = [bank && `transferred to ${bank}`, org.upi_id && `paid by UPI to ${org.upi_id}`].filter(Boolean);
    const ask =
      l.closing_paise > 0
        ? `Kindly clear the outstanding balance of Rs. ${amt(l.closing_paise)} (${amountInWords(l.closing_paise)}) at the earliest.${how.length ? ` Fees can be paid by cheque or ${andList(how).replace(" and ", " or ")}.` : ""}`
        : l.closing_paise < 0
          ? `There is a balance of Rs. ${amt(-l.closing_paise)} in your favour as on ${dmy(l.to)}.`
          : `Nothing is outstanding as on ${dmy(l.to)}. Thank you.`;
    pen.ensure(40);
    pen.y += 4;
    pen.paragraph(ask, PAGE.margin, CONTENT_WIDTH, { size: 9, gap: 6 });
    pen.draw("E. & O.E.", PAGE.margin, pen.y, { size: 8.5, color: MUTED });
    pen.y += 16;
    if (org.signatory_name || org.org_name) signOff(pen, org);
    return { footer: `Statement of account: ${l.name}`, stamp: null, note: jurisdictionLine(org) };
  });
}

export function renderFeesReportPdf(r: FeesReport, org: Settings, logo: Logo | null): Promise<Buffer> {
  return build("Fees report", org.org_name, (pen) => {
    letterhead(pen, org, logo);
    titleBlock(pen, "FEES REPORT", [
      `${prettyDate(r.from)} to ${prettyDate(r.to)}${r.group_name ? `  ·  Group: ${r.group_name}` : ""}`,
      `Prepared on ${prettyDate(new Date().toISOString().slice(0, 10))}`,
    ]);
    const s = r.summary;
    pen.draw("SUMMARY", PAGE.margin, pen.y, { size: 8, bold: true, color: MUTED });
    pen.y += 13;
    figures(pen, [
      ["Bills issued", `${s.bills}${s.cancelled ? `  (+${s.cancelled} cancelled)` : ""}`],
      ["Fees (income)", money(s.fees_paise)],
      ["GST charged", money(s.gst_paise)],
      ["Paid on clients' behalf", money(s.reimbursement_paise)],
      ["Total billed", money(s.total_paise)],
      ["Received", money(s.received_paise)],
      ["  of which fees and GST", money(s.fees_received_paise)],
      ["  of which reimbursed", money(s.reimbursed_paise)],
      ["Credit notes and discounts", money(s.credited_paise + s.discount_paise)],
      ["Outstanding", money(s.outstanding_paise)],
    ], 5);

    if (r.months.length) {
      pen.draw("MONTH BY MONTH", PAGE.margin, pen.y, { size: 8, bold: true, color: MUTED });
      pen.y += 13;
      grid(pen, [
        { label: "Month", width: 90 }, { label: "Bills", width: 50, align: "right" }, { label: "Fees (₹)", width: 100, align: "right" },
        { label: "GST (₹)", width: 90, align: "right" }, { label: "Paid on behalf (₹)", width: 110, align: "right" }, { label: "Received (₹)", width: 100, align: "right" },
      ], [
        ...r.months.map((m) => ({ cells: [m.month, String(m.bills), money(m.fees_paise), money(m.gst_paise), money(m.reimbursement_paise), money(m.received_paise)] })),
        { cells: ["Total", String(s.bills), money(s.fees_paise), money(s.gst_paise), money(s.reimbursement_paise), money(s.received_paise)], bold: true, rule: true },
      ], 8.5);
    }

    pen.ensure(60);
    pen.draw("BILLS", PAGE.margin, pen.y, { size: 8, bold: true, color: MUTED });
    pen.y += 13;
    grid(pen, [
      { label: "Bill no.", width: 70 }, { label: "Date", width: 58 }, { label: "Client", width: 130, wrap: true }, { label: "Group", width: 80, wrap: true },
      { label: "Fees", width: 66, align: "right" }, { label: "GST", width: 56, align: "right" }, { label: "On behalf", width: 62, align: "right" },
      { label: "Total", width: 68, align: "right" }, { label: "Received", width: 68, align: "right" }, { label: "Cr./disc.", width: 58, align: "right" },
      { label: "Balance", width: 66, align: "right" }, { label: "Status", width: 58 },
    ], [
      ...r.rows.map((b) => ({
        muted: b.cancelled,
        cells: [b.bill_no, prettyDate(b.bill_date), b.client_name, b.group_name ?? "", money(b.fees_paise), money(b.gst_paise), b.reimbursement_paise ? money(b.reimbursement_paise) : "",
          money(b.total_paise), money(b.received_paise), b.reduced_paise ? money(b.reduced_paise) : "", b.cancelled ? "" : money(b.balance_paise), b.status],
      })),
      ...(r.rows.length ? [] : [{ cells: ["No bills in this period", "", "", "", "", "", "", "", "", "", "", ""], muted: true }]),
      { cells: ["Total", "", "", "", money(s.fees_paise), money(s.gst_paise), money(s.reimbursement_paise), money(s.total_paise), money(s.received_paise), money(s.credited_paise + s.discount_paise), money(s.outstanding_paise), ""], bold: true, rule: true },
    ], 7.5);
    pen.paragraph("Fees are the firm's income. GST and amounts paid on clients' behalf are shown separately and are not income. Cancelled bills are listed but not counted in any total.", PAGE.margin, CONTENT_WIDTH, { size: 8, color: MUTED });
    return { footer: `Fees report ${prettyDate(r.from)} to ${prettyDate(r.to)}`, stamp: null };
  }, "landscape");
}
