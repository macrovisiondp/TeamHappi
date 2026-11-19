"use server";

import { getWorkspace, pushApi } from "@/lib/workspace";

// Server actions for shift alerts (M12). The member and organisation come from
// the session; the subscription from the browser is validated on the server.

async function ready() {
  const ws = await getWorkspace();
  return ws?.kind === "ready" ? ws : null;
}

export async function enableAlertsAction(raw: unknown): Promise<boolean> {
  const ws = await ready();
  return ws ? (await pushApi.subscribe(ws, raw)).ok : false;
}

export async function disableAlertsAction(endpoint: unknown): Promise<boolean> {
  const ws = await ready();
  return ws ? (await pushApi.unsubscribe(ws, endpoint)).ok : false;
}
