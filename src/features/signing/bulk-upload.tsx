"use client";

import {
  CheckCircle2,
  FileUp,
  FolderOpen,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { reloadWithNote } from "@/components/ui/toast";

import { uploadPolicyAction } from "./actions";
import { kindFromFileName, titleFromFileName, type Kind } from "./bulk-names";

// Upload several documents at once (M21). Each PDF gets a title from its file
// name (editable) and a type (a contract template when the name says
// "contract"). Files go up one at a time through the same checked upload as
// the single form, with progress shown, so a large batch never hits a size
// limit and one bad file doesn't stop the rest.

interface Item {
  file: File;
  title: string;
  kind: Kind;
  state: "waiting" | "uploading" | "done" | "failed";
  message?: string;
}

const MAX_BYTES = 4 * 1024 * 1024;

export function BulkUpload() {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const add = (files: FileList | null) => {
    if (!files) return;
    const pdfs = [...files].filter((f) => /\.pdf$/i.test(f.name));
    setItems((cur) => [
      ...cur,
      ...pdfs
        .filter((f) => !cur.some((c) => c.file.name === f.name))
        .map((file) => ({
          file,
          title: titleFromFileName(file.name),
          kind: kindFromFileName(file.name),
          state: "waiting" as const,
        })),
    ]);
  };
  const patch = (i: number, p: Partial<Item>) =>
    setItems((cur) => cur.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const uploadAll = async () => {
    setBusy(true);
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (it.state === "done") continue;
      if (it.file.size > MAX_BYTES) {
        patch(i, { state: "failed", message: "Larger than 4 MB" });
        continue;
      }
      patch(i, { state: "uploading" });
      const form = new FormData();
      form.set("title", it.title);
      form.set("kind", it.kind);
      form.set("file", it.file);
      const r = await uploadPolicyAction({ status: "idle" }, form).catch(
        () => ({ status: "error" as const, message: "Couldn't upload" }),
      );
      if (r.status === "saved") {
        ok += 1;
        patch(i, { state: "done" });
      } else
        patch(i, {
          state: "failed",
          message: r.status === "error" ? r.message : "Couldn't upload",
        });
    }
    setBusy(false);
    if (ok) reloadWithNote(`${ok} document${ok === 1 ? "" : "s"} added`);
  };

  const waiting = items.filter((x) => x.state !== "done").length;
  const done = items.filter((x) => x.state === "done").length;

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-6 text-center ${
          dragging ? "border-forest bg-sage" : "border-line-strong bg-surface"
        }`}
      >
        <FileUp aria-hidden="true" className="size-8 text-forest" />
        <div>
          <p className="font-semibold">Drop your PDFs here</p>
          <p className="text-sm text-ink-muted">
            Or choose several at once. Each title comes from its file name, and
            anything with &ldquo;contract&rdquo; in its name is set up as a
            contract template. You can change both before uploading.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => input.current?.click()}
          disabled={busy}
        >
          <FolderOpen aria-hidden="true" />
          Choose PDFs
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          aria-label="PDF files"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length ? (
        <>
          <ul className="flex flex-col gap-2" aria-label="Documents to upload">
            {items.map((it, i) => (
              <li
                key={it.file.name}
                className="grid items-center gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_12rem_auto]"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <Input
                    aria-label={`Title for ${it.file.name}`}
                    value={it.title}
                    maxLength={120}
                    disabled={busy || it.state === "done"}
                    onChange={(e) => patch(i, { title: e.target.value })}
                  />
                  <span className="truncate text-xs text-ink-muted">
                    {it.file.name} · {Math.round(it.file.size / 1024)} KB
                  </span>
                </div>
                <Select
                  aria-label={`Type for ${it.file.name}`}
                  value={it.kind}
                  disabled={busy || it.state === "done"}
                  onChange={(e) => patch(i, { kind: e.target.value as Kind })}
                >
                  <option value="policy">Policy</option>
                  <option value="contract_template">Contract template</option>
                </Select>
                <span className="flex items-center justify-end gap-1.5 text-sm">
                  {it.state === "uploading" ? (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                  ) : it.state === "done" ? (
                    <>
                      <CheckCircle2
                        aria-hidden="true"
                        className="size-4 text-forest"
                      />
                      Added
                    </>
                  ) : it.state === "failed" ? (
                    <span className="flex items-center gap-1 text-danger">
                      <XCircle aria-hidden="true" className="size-4" />
                      {it.message}
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Remove ${it.file.name}`}
                      disabled={busy}
                      onClick={() =>
                        setItems((cur) => cur.filter((_, k) => k !== i))
                      }
                      className="grid size-9 place-items-center rounded-md text-ink-muted hover:bg-sage"
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={uploadAll}
              disabled={busy || waiting === 0}
            >
              {busy ? (
                <>
                  <Loader2 aria-hidden="true" className="animate-spin" />
                  Uploading {done + 1} of {items.length}
                </>
              ) : (
                `Upload ${waiting} document${waiting === 1 ? "" : "s"}`
              )}
            </Button>
            <span className="text-sm text-ink-muted">
              Policies: {items.filter((x) => x.kind === "policy").length} ·
              Contract templates:{" "}
              {items.filter((x) => x.kind === "contract_template").length}
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
