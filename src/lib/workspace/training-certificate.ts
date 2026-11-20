// Course certificates (M15, T5): one A4 landscape page made on download from
// the training record. Nothing is stored; the record is the source of truth.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { formatDate } from "@/lib/format";
import type { CertificateFacts } from "@/modules/training";

import { pdfSafe } from "./signature-page";

const FOREST = rgb(0.11, 0.3, 0.24);
const INK = rgb(0.12, 0.12, 0.12);
const MUTED = rgb(0.4, 0.4, 0.4);

export async function certificatePdf(
  f: CertificateFacts,
  organisation: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Certificate: ${f.courseName}`));
  doc.setProducer("TeamHappi");
  doc.setCreator("TeamHappi");
  const page = doc.addPage([841.89, 595.28]);
  const { width, height } = page.getSize();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({
    x: 24,
    y: 24,
    width: width - 48,
    height: height - 48,
    borderColor: FOREST,
    borderWidth: 3,
  });

  const centre = (
    text: string,
    y: number,
    size: number,
    font = regular,
    color = INK,
  ) => {
    const safe = pdfSafe(text);
    let s = size;
    while (font.widthOfTextAtSize(safe, s) > width - 120 && s > 8) s -= 1;
    page.drawText(safe, {
      x: (width - font.widthOfTextAtSize(safe, s)) / 2,
      y,
      size: s,
      font,
      color,
    });
  };

  centre(organisation, height - 90, 16, bold, FOREST);
  centre("Certificate of completion", height - 150, 34, bold);
  centre("This certifies that", height - 200, 14, regular, MUTED);
  centre(f.personName, height - 245, 30, bold);
  centre(
    "completed the course and passed the final assessment",
    height - 280,
    14,
    regular,
    MUTED,
  );
  centre(
    f.code ? `${f.code}  ${f.courseName}` : f.courseName,
    height - 320,
    20,
    bold,
    FOREST,
  );

  const facts: [string, string][] = [
    ["Completed", formatDate(f.completedOn)],
    ["Final score", f.scorePercent === null ? "-" : `${f.scorePercent}%`],
    ["Renew by", f.expiresOn ? formatDate(f.expiresOn) : "Doesn't expire"],
    ["Certificate no.", f.certificateNo],
  ];
  const colW = (width - 160) / facts.length;
  facts.forEach(([k, v], i) => {
    const x = 80 + i * colW;
    page.drawText(pdfSafe(k), {
      x,
      y: 190,
      size: 10,
      font: regular,
      color: MUTED,
    });
    page.drawText(pdfSafe(v), { x, y: 172, size: 13, font: bold, color: INK });
  });

  if (f.signedOffBy) {
    page.drawText(pdfSafe(`Practical skills signed off by ${f.signedOffBy}.`), {
      x: 80,
      y: 130,
      size: 11,
      font: regular,
      color: INK,
    });
  }
  page.drawText(
    pdfSafe(
      "Issued by TeamHappi from the organisation's training record. It confirms completion of in-house training; it isn't an accredited qualification.",
    ),
    {
      x: 80,
      y: 60,
      size: 8.5,
      font: regular,
      color: MUTED,
      maxWidth: width - 160,
    },
  );
  return doc.save();
}
