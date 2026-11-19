// TeamHappi service worker (M12). Push alerts only: no caching, so pages are
// always fresh and nothing private is stored on the device. Alerts carry no
// names, times or places; tapping one opens TeamHappi.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "TeamHappi";
  const body =
    typeof data.body === "string" ? data.body : "You have an update.";
  // Only TeamHappi's own pages can be opened from an alert.
  const url =
    typeof data.url === "string" &&
    data.url.startsWith("/") &&
    !data.url.startsWith("//")
      ? data.url
      : "/dashboard";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/app-icon/192",
      badge: "/app-icon/192",
      tag: "teamhappi-shifts",
      renotify: true,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || "/dashboard",
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list)
          if (
            client.url.startsWith(self.location.origin) &&
            "focus" in client
          ) {
            client.navigate(url);
            return client.focus();
          }
        return self.clients.openWindow(url);
      }),
  );
});
