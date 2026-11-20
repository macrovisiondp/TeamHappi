"use server";

import { getWorkspace, imagesApi } from "@/lib/workspace";

// Photo and logo uploads (M17). The organisation and member come from the
// session; who may change what is checked by the workspace layer.

type Result = { ok: true } | { ok: false; message: string };
const SIGNED_OUT: Result = {
  ok: false,
  message: "Please sign in again, then try once more.",
};

async function bytesOf(form: FormData) {
  const f = form.get("image");
  if (!f || typeof f === "string") return new Uint8Array();
  if (f.size > 400_000) return new Uint8Array(400_001);
  return new Uint8Array(await f.arrayBuffer());
}

export async function uploadPhoto(
  employeeId: string,
  form: FormData,
): Promise<Result> {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return SIGNED_OUT;
  return imagesApi.setPhoto(ws, employeeId, await bytesOf(form));
}

export async function deletePhoto(employeeId: string): Promise<Result> {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return SIGNED_OUT;
  return imagesApi.removePhoto(ws, employeeId);
}

export async function uploadLogo(form: FormData): Promise<Result> {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return SIGNED_OUT;
  return imagesApi.setLogo(ws, await bytesOf(form));
}

export async function deleteLogo(): Promise<Result> {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return SIGNED_OUT;
  return imagesApi.removeLogo(ws);
}
