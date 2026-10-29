// M9.2b: CV content checks and the storage selection. No network: the S3
// store is only constructed, never called.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { localDiskStore, s3Settings } from "@/integrations/storage/blob";
import {
  CV_MAX_BYTES,
  CV_TYPES,
  cleanFileName,
  inspectCv,
} from "@/modules/recruitment";

const bytes = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));
const pdf = (body = "1 0 obj << /Type /Catalog >> endobj") =>
  bytes(`%PDF-1.7\n${body}\n%%EOF`);
const docx = (extra = "") =>
  bytes(
    `PK\x03\x04....[Content_Types].xml....PK\x03\x04....word/document.xml....${extra}`,
  );

describe("CV content checks", () => {
  it("accepts a plain PDF and a .docx by their content, whatever the name says", () => {
    expect(inspectCv(pdf(), "cv.docx")).toMatchObject({
      ok: true,
      contentType: CV_TYPES.pdf,
      fileName: "cv.pdf",
    });
    const d = inspectCv(docx(), "My CV.docx");
    expect(d).toMatchObject({
      ok: true,
      contentType: CV_TYPES.docx,
      fileName: "My CV.docx",
    });
    expect(d.ok && d.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses PDFs with scripts, launch actions or attachments", () => {
    for (const bad of [
      "<< /S /JavaScript /JS (app.alert(1)) >>",
      "<< /OpenAction << /S /Launch /F (cmd.exe) >> >>",
      "<< /Type /EmbeddedFile >>",
    ])
      expect(inspectCv(pdf(bad), "cv.pdf")).toMatchObject({ ok: false });
  });

  it("refuses macro Word files, old .doc, other zips, HTML, images and executables", () => {
    expect(inspectCv(docx("word/vbaProject.bin"), "cv.docx")).toMatchObject({
      ok: false,
    });
    for (const [content, name] of [
      ["\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1 old word", "cv.doc"],
      ["PK\x03\x04 not a word file", "cv.zip"],
      ["<html><script>alert(1)</script></html>", "cv.pdf"],
      ["\x89PNG\r\n\x1a\n", "cv.png"],
      ["MZ\x90\x00 executable", "cv.pdf"],
    ] as const)
      expect(inspectCv(bytes(content), name), name).toMatchObject({
        ok: false,
      });
  });

  it("refuses empty and oversized files", () => {
    expect(inspectCv(new Uint8Array(), "cv.pdf")).toMatchObject({ ok: false });
    const big = new Uint8Array(CV_MAX_BYTES + 1);
    big.set(pdf());
    expect(inspectCv(big, "cv.pdf")).toMatchObject({ ok: false });
  });

  it("cleans file names: no paths, quotes or control characters, real extension", () => {
    expect(cleanFileName('C:\\Users\\x\\..\\Jane "CV".pdf', "pdf")).toBe(
      "Jane CV.pdf",
    );
    expect(cleanFileName("../../etc/passwd", "pdf")).toBe("passwd.pdf");
    expect(cleanFileName("cv\u0000\u001f.exe", "docx")).toBe("cv.exe.docx");
    expect(cleanFileName("   ", "pdf")).toBe("CV.pdf");
    expect(cleanFileName("a".repeat(400), "pdf")).toHaveLength(154);
  });
});

describe("storage selection", () => {
  const full = {
    APPROVED_LIVE_PROVIDERS: "resend, aws-s3",
    STORAGE_S3_BUCKET: "bucket",
    STORAGE_S3_REGION: "eu-west-2",
    STORAGE_S3_ACCESS_KEY_ID: "synthetic-id",
    STORAGE_S3_SECRET_ACCESS_KEY: "synthetic-secret",
  };

  it("uses S3 only when the owner approved it and every setting is present", () => {
    expect(s3Settings(full)).toMatchObject({
      bucket: "bucket",
      region: "eu-west-2",
    });
    expect(s3Settings({ ...full, APPROVED_LIVE_PROVIDERS: "" })).toBeNull();
    expect(
      s3Settings({ ...full, APPROVED_LIVE_PROVIDERS: "aws-s3x" }),
    ).toBeNull();
    for (const name of Object.keys(full).filter((k) => k.startsWith("STORAGE")))
      expect(s3Settings({ ...full, [name]: " " }), name).toBeNull();
  });

  it("never uses the local file store in production", () => {
    expect(() => localDiskStore(undefined, "production")).toThrow();
  });

  describe("local file store", () => {
    let root: string;
    const key = `tenants/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/objects/abcdefghijklmnopqrstuv`;
    afterAll(async () => {
      if (root) await rm(root, { recursive: true, force: true });
    });

    it("stores, reads and deletes; refuses bad keys and overwrites", async () => {
      root = await mkdtemp(join(tmpdir(), "teamhappi-blob-"));
      const store = localDiskStore(root, "local");
      await store.put(key, bytes("hello"), CV_TYPES.pdf);
      expect(Buffer.from(await store.get(key)).toString()).toBe("hello");
      await expect(
        store.put(key, bytes("again"), CV_TYPES.pdf),
      ).rejects.toThrow();
      await store.remove(key);
      await expect(store.get(key)).rejects.toThrow(/not found/);
      for (const bad of [
        "../outside",
        "tenants/x/objects/abcdefghijklmnopqrstuv",
        `${key}/../../escape`,
      ])
        await expect(store.put(bad, bytes("x"), CV_TYPES.pdf)).rejects.toThrow(
          /Invalid object key/,
        );
    });
  });
});
