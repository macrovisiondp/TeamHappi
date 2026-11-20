"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";

import { FormError } from "@/components/ui/form-error";
import { Button } from "@/components/ui/button";

import { disableAlertsAction, enableAlertsAction } from "./actions";

// Turns shift alerts on or off for THIS device (M12). Alerts say only "Your
// shifts have changed", so nothing private shows on a locked phone.

function keyBytes(base64url: string) {
  const padded = base64url + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State =
  | "checking"
  | "unsupported"
  | "ios-install"
  | "blocked"
  | "off"
  | "on"
  | "busy";

export function ShiftAlerts({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const installed =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState(ios && !installed ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("blocked");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })();
  }, []);

  async function turnOn() {
    setError(null);
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const saved = await enableAlertsAction(JSON.parse(JSON.stringify(sub)));
      if (!saved) {
        await sub.unsubscribe();
        throw new Error("not saved");
      }
      setState("on");
    } catch {
      setError("Alerts couldn't be turned on. Try again in a moment.");
      setState("off");
    }
  }

  async function turnOff() {
    setError(null);
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await disableAlertsAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Alerts couldn't be turned off. Try again in a moment.");
      setState("on");
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {error ? <FormError message={error} /> : null}
      {state === "checking" ? (
        <p className="text-ink-muted">Checking this device…</p>
      ) : state === "unsupported" ? (
        <p>This browser can&rsquo;t show alerts.</p>
      ) : state === "ios-install" ? (
        <p>
          On iPhone, first add TeamHappi to your Home Screen: tap Share, then
          &ldquo;Add to Home Screen&rdquo;. Open it from there and turn alerts
          on.
        </p>
      ) : state === "blocked" ? (
        <p>
          Alerts are blocked for TeamHappi in this browser&rsquo;s settings.
          Allow notifications there, then come back.
        </p>
      ) : state === "on" ? (
        <>
          <p role="status">
            Alerts are on for this device. You&rsquo;ll get a message when your
            shifts change.
          </p>
          <div>
            <Button variant="secondary" size="sm" onClick={turnOff}>
              <BellOff aria-hidden="true" />
              Turn off alerts
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>
            Get a message on this device when your published shifts change.
            Alerts never show times, places or names.
          </p>
          <div>
            <Button size="sm" onClick={turnOn} disabled={state === "busy"}>
              <Bell aria-hidden="true" />
              {state === "busy" ? "Turning on…" : "Turn on shift alerts"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
