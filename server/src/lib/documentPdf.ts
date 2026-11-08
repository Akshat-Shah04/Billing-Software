import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import PDFDocument from "pdfkit";
import type { Settings } from "../routes/settings.js";
import { METHOD_LABELS, dueLine, fyLongLabel, jurisdictionLine, money, paymentLines, prettyDate, prettyTimestamp, type PaymentMethod } from "./format.js";
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
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const BOTTOM = PAGE.height - PAGE.margin - 8; // content stops here; the footer line sits below it (at height - 30)

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

function build(title: string, author: string, draw: (pen: Pen) => { footer: string; stamp: string | null; note?: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: PAGE.margin, bufferPages: true, info: { Title: title, Author: author || "Billing Software" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const pen = new Pen(doc);
  const { footer, stamp, note } = draw(pen);
  decoratePages(pen, footer, stamp, note);
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
    itemsTable(pen, bill.items, { heading: "Being the charges for services rendered", year: true });

    const rows: Parameters<typeof totals>[1] = [];
    if (bill.gst_rate_percent > 0) {
      rows.push({ label: "Subtotal", value: money(bill.subtotal_paise) });
      rows.push({ label: `GST @ ${bill.gst_rate_percent}%`, value: money(bill.gst_paise) });
    }
    rows.push({ label: "Total", value: money(bill.total_paise), strong: true });
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
