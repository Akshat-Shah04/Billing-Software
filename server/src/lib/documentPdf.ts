import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import PDFDocument from "pdfkit";
import type { Settings } from "../routes/settings.js";
import { METHOD_LABELS, fyLabelOf, money, paymentLines, prettyDate, prettyTimestamp, type PaymentMethod } from "./format.js";

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
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const BOTTOM = PAGE.height - PAGE.margin - 18; // leave room for the footer

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

function header(pen: Pen, org: Settings, logo: Logo | null, right: { label?: string; number: string; lines: { text: string; bold?: boolean; color?: string }[]; tag?: { text: string; color: string } }) {
  const { doc } = pen;
  const rightW = 190;
  const leftW = CONTENT_WIDTH - rightW - 16;
  let ly = pen.y;

  if (logo) {
    try {
      const img = (doc as unknown as { openImage(b: Buffer): { width: number; height: number } }).openImage(logo.data);
      const scale = Math.min(190 / img.width, 62 / img.height, 1);
      doc.image(logo.data, PAGE.margin, ly, { width: img.width * scale });
      ly += img.height * scale + 8;
    } catch {
      /* an unreadable logo is skipped rather than failing the whole document */
    }
  }
  pen.y = ly;
  pen.paragraph(org.org_name || "Bill", PAGE.margin, leftW, { size: 16, bold: true, gap: 2 });
  if (org.org_address) pen.paragraph(org.org_address, PAGE.margin, leftW, { size: 8.8, color: MUTED });
  if (org.org_gstin) pen.paragraph(`GSTIN: ${org.org_gstin}`, PAGE.margin, leftW, { size: 8.8, color: MUTED });
  const leftEnd = pen.y;

  let ry = PAGE.margin;
  const rx = PAGE.width - PAGE.margin;
  if (right.label) { pen.draw(right.label, rx, ry, { size: 9, bold: true, color: MUTED, align: "right" }); ry += 14; }
  pen.draw(right.number, rx, ry, { size: 14, bold: true, align: "right" }); ry += 20;
  for (const l of right.lines) { pen.draw(l.text, rx, ry, { size: 9.5, bold: l.bold, color: l.color ?? MUTED, align: "right" }); ry += 13; }
  if (right.tag) { pen.draw(right.tag.text, rx, ry + 2, { size: 10, bold: true, color: right.tag.color, align: "right" }); ry += 18; }

  pen.y = Math.max(leftEnd, ry) + 14;
  pen.rule(pen.y);
  pen.y += 14;
}

function billedTo(pen: Pen, d: any) {
  pen.draw("BILLED TO", PAGE.margin, pen.y, { size: 7.5, bold: true, color: MUTED });
  pen.y += 12;
  pen.paragraph(d.client_name, PAGE.margin, CONTENT_WIDTH * 0.6, { size: 11.5, bold: true });
  if (d.client_address) pen.paragraph(d.client_address, PAGE.margin, CONTENT_WIDTH * 0.6, { size: 9, color: MUTED });
  const meta = [d.client_city, d.client_phone].filter(Boolean).join(" · ");
  if (meta) pen.paragraph(meta, PAGE.margin, CONTENT_WIDTH * 0.6, { size: 9, color: MUTED });
  if (d.client_gstin) pen.paragraph(`GSTIN: ${d.client_gstin}`, PAGE.margin, CONTENT_WIDTH * 0.6, { size: 9, color: MUTED });
  if (d.client_pan) pen.paragraph(`PAN: ${d.client_pan}`, PAGE.margin, CONTENT_WIDTH * 0.6, { size: 9, color: MUTED });
  pen.y += 12;
}

const COLS = { qty: 56, price: 84, amount: 92 }; // "qty" is the financial year column now

function itemsTable(pen: Pen, items: any[]) {
  const right = PAGE.width - PAGE.margin;
  const xAmount = right;
  const xPrice = right - COLS.amount;
  const xQty = xPrice - COLS.price;
  const itemW = xQty - COLS.qty - PAGE.margin - 8;

  const head = () => {
    pen.draw("ITEM", PAGE.margin, pen.y, { size: 7.5, bold: true, color: MUTED });
    pen.draw("FY", xQty, pen.y, { size: 7.5, bold: true, color: MUTED, align: "right" });
    pen.draw("PRICE", xPrice, pen.y, { size: 7.5, bold: true, color: MUTED, align: "right" });
    pen.draw("AMOUNT", xAmount, pen.y, { size: 7.5, bold: true, color: MUTED, align: "right" });
    pen.y += 13;
    pen.rule(pen.y, PAGE.margin, right, "#aab2c0", 0.8);
    pen.y += 8;
  };
  head();

  for (const it of items) {
    // The title is much larger and bolder than its description underneath, as on screen.
    const titleLines = pen.lines(it.description, 11.5, true, itemW);
    const detailLines = it.details ? pen.lines(it.details, 8.5, false, itemW) : [];
    const height = titleLines.length * 15 + (detailLines.length ? 3 + detailLines.length * 11.5 : 0) + 10;
    pen.ensure(height + 4, head);
    titleLines.forEach((l, n) => pen.draw(l, PAGE.margin, pen.y + n * 15, { size: 11.5, bold: true }));
    detailLines.forEach((l, n) => pen.draw(l, PAGE.margin, pen.y + titleLines.length * 15 + 3 + n * 11.5, { size: 8.5, color: MUTED }));
    pen.draw(it.fy_start ? fyLabelOf(it.fy_start) : "", xQty, pen.y + 1.5, { size: 10, align: "right" });
    pen.draw(money(it.unit_price_paise), xPrice, pen.y + 1.5, { size: 10, align: "right" });
    // A quantity is only shown when it is more than one (older bills), under the price.
    if (it.quantity > 1) pen.draw(`x ${it.quantity}`, xPrice, pen.y + 15, { size: 8.5, color: MUTED, align: "right" });
    pen.draw(money(it.line_total_paise), xAmount, pen.y + 1.5, { size: 10, bold: true, align: "right" });
    pen.y += height;
    pen.rule(pen.y - 5);
  }
  pen.y += 6;
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

/** Page numbers, a faint stamp on cancelled bills, and the document number on every page. */
function decoratePages(pen: Pen, docLabel: string, stamp: string | null) {
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
  }
}

function build(title: string, author: string, draw: (pen: Pen) => { footer: string; stamp: string | null }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: PAGE.margin, bufferPages: true, info: { Title: title, Author: author || "Billing Software" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const pen = new Pen(doc);
  const { footer, stamp } = draw(pen);
  decoratePages(pen, footer, stamp);
  doc.end();
  return done;
}

export function renderBillPdf(bill: any, org: Settings, logo: Logo | null): Promise<Buffer> {
  const cancelled = bill.status === "cancelled";
  return build(`Bill ${bill.bill_no}`, org.org_name, (pen) => {
    header(pen, org, logo, {
      number: bill.bill_no,
      lines: [
        { text: prettyDate(bill.bill_date), bold: true, color: INK },
        ...(bill.due_date && !cancelled ? [{ text: `Due ${prettyDate(bill.due_date)}` }] : []),
      ],
      tag: cancelled ? { text: "CANCELLED", color: RED } : bill.state === "paid" ? { text: "PAID", color: GREEN } : undefined,
    });
    billedTo(pen, bill);
    itemsTable(pen, bill.items);

    const rows: Parameters<typeof totals>[1] = [{ label: "Subtotal", value: money(bill.subtotal_paise) }];
    if (bill.gst_rate_percent > 0) rows.push({ label: `GST @ ${bill.gst_rate_percent}%`, value: money(bill.gst_paise) });
    rows.push({ label: "Total", value: money(bill.total_paise), strong: true });
    if (bill.credited_paise > 0) rows.push({ label: "Credit notes", value: `- ${money(bill.credited_paise)}` });
    if (bill.paid_paise > 0) rows.push({ label: "Paid", value: `- ${money(bill.paid_paise)}` });
    if (bill.discount_paise > 0) rows.push({ label: "Discount", value: `- ${money(bill.discount_paise)}` });
    if (bill.credited_paise > 0 || bill.paid_paise > 0 || bill.discount_paise > 0) rows.push({ label: "Balance due", value: money(bill.balance_paise), strong: true });
    totals(pen, rows);

    if (cancelled) {
      pen.ensure(40);
      pen.paragraph(`This bill was cancelled on ${prettyTimestamp(bill.cancelled_at)}${bill.cancelled_by_name ? ` by ${bill.cancelled_by_name}` : ""}: ${bill.cancel_reason}`, PAGE.margin, CONTENT_WIDTH, { size: 9.5, color: RED, gap: 8 });
    }
    if (bill.notes) {
      pen.ensure(40);
      pen.draw("NOTES", PAGE.margin, pen.y, { size: 7.5, bold: true, color: MUTED });
      pen.y += 12;
      pen.paragraph(bill.notes, PAGE.margin, CONTENT_WIDTH, { size: 9.5, gap: 8 });
    }
    const payments = (bill.payments ?? []).filter((p: any) => !p.voided_at);
    if (payments.length) {
      section(pen, "Payments received", payments.map((p: any) => [prettyDate(p.paid_on), `${METHOD_LABELS[p.method as PaymentMethod] ?? p.method}${p.reference ? ` - ${p.reference}` : ""}`, money(p.amount_paise)]), [90, CONTENT_WIDTH - 90 - 110, 110], ["left", "left", "right"]);
    }
    if ((bill.credit_notes ?? []).length) {
      section(pen, "Credit notes", bill.credit_notes.map((c: any) => [c.cn_no, prettyDate(c.cn_date), money(c.total_paise)]), [150, CONTENT_WIDTH - 150 - 110, 110], ["left", "left", "right"]);
    }
    if (!cancelled) paymentBox(pen, org);
    return { footer: bill.bill_no, stamp: cancelled ? "CANCELLED" : null };
  });
}

export function renderCreditNotePdf(cn: any, org: Settings, logo: Logo | null): Promise<Buffer> {
  return build(`Credit note ${cn.cn_no}`, org.org_name, (pen) => {
    header(pen, org, logo, {
      label: "CREDIT NOTE",
      number: cn.cn_no,
      lines: [{ text: prettyDate(cn.cn_date), bold: true, color: INK }, { text: `Against bill ${cn.bill_no}` }, { text: `dated ${prettyDate(cn.bill_date)}` }],
    });
    billedTo(pen, cn);
    itemsTable(pen, cn.items);
    const rows: Parameters<typeof totals>[1] = [{ label: "Subtotal", value: money(cn.subtotal_paise) }];
    if (cn.gst_rate_percent > 0) rows.push({ label: `GST @ ${cn.gst_rate_percent}%`, value: money(cn.gst_paise) });
    rows.push({ label: "Credit total", value: money(cn.total_paise), strong: true });
    totals(pen, rows);
    pen.ensure(50);
    pen.draw("REASON", PAGE.margin, pen.y, { size: 7.5, bold: true, color: MUTED });
    pen.y += 12;
    pen.paragraph(cn.reason, PAGE.margin, CONTENT_WIDTH, { size: 9.5, gap: 8 });
    pen.paragraph(`This credit note reduces the amount due on bill ${cn.bill_no}.`, PAGE.margin, CONTENT_WIDTH, { size: 8.5, color: MUTED });
    return { footer: cn.cn_no, stamp: null };
  });
}
