// The signature page added to signed documents (M13). The original pages are
// copied unchanged; one A4 page is appended recording who signed, when, how,
// and the SHA-256 fingerprint of the exact file that was signed.

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export interface SignatureInfo {
  title: string;
  organisation: string;
  documentSha256: string;
  employee: { name: string; at: Date };
  countersign: { name: string; at: Date } | null;
}

/** Whether TeamHappi can add a page to this PDF (it opens and isn't locked). */
export async function canSign(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return doc.getPageCount() > 0;
  } catch {
    return false;
  }
}

/** Text the standard PDF font can draw (accents kept where possible). */
export function pdfSafe(text: string): string {
  return [...text.normalize("NFC")]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (code >= 0x20 && code <= 0x7e) return ch;
      if (code >= 0xa0 && code <= 0xff) return ch;
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      return /^[\x20-\x7e]+$/.test(base) ? base : "?";
    })
    .join("");
}

export const ukTime = (at: Date) =>
  `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at)} (UK time)`;

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The original PDF with a signature page appended. */
export async function appendSignaturePage(
  original: Uint8Array,
  info: SignatureInfo,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { updateMetadata: false });
  const page = doc.addPage([595.28, 841.89]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.12, 0.12);
  const muted = rgb(0.35, 0.37, 0.36);
  const left = 56;
  const width = 595.28 - left * 2;
  let y = 780;

  const text = (
    s: string,
    opts: {
      size?: number;
      font?: PDFFont;
      color?: typeof ink;
      gap?: number;
    } = {},
  ) => {
    const size = opts.size ?? 11;
    const font = opts.font ?? regular;
    for (const line of wrap(pdfSafe(s), font, size, width)) {
      page.drawText(line, { x: left, y, size, font, color: opts.color ?? ink });
      y -= size + 5;
    }
    y -= opts.gap ?? 4;
  };
  const block = (
    heading: string,
    who: { name: string; at: Date },
    statement: string,
  ) => {
    y -= 8;
    page.drawLine({
      start: { x: left, y: y + 6 },
      end: { x: left + width, y: y + 6 },
      thickness: 0.5,
      color: muted,
    });
    y -= 10;
    text(heading, { font: bold, size: 12 });
    text(`Signed by: ${who.name}`, { size: 13, font: bold });
    text(`Date and time: ${ukTime(who.at)}`);
    text(statement, { color: muted, size: 10 });
  };

  text("Electronic signature record", { font: bold, size: 18, gap: 10 });
  text(`Document: ${info.title}`, { font: bold });
  text(`Organisation: ${info.organisation}`);
  text("Fingerprint of the document signed (SHA-256):", {
    size: 9,
    color: muted,
    gap: 0,
  });
  text(info.documentSha256, { size: 9, color: muted, gap: 8 });

  block(
    "Employee",
    info.employee,
    'Signed electronically in TeamHappi while signed in with their own verified login, by typing their name and confirming: "I have read this document and I agree to sign it electronically."',
  );
  if (info.countersign)
    block(
      `For and on behalf of ${info.organisation}`,
      info.countersign,
      "Countersigned electronically in TeamHappi by an authorised person, by typing their name.",
    );

  y = 60;
  text(
    "This page was added by TeamHappi. The pages before it are unchanged from the document that was signed; its fingerprint above can be checked against the original file.",
    { size: 8, color: muted },
  );
  return doc.save({ useObjectStreams: false });
}
