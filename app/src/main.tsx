import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import { WalletProvider } from "./wallet/WalletProvider";
import { App } from "./App";
import "./styles/theme.css";

async function clearDevServiceWorker() {
  if (!import.meta.env.DEV || !("serviceWorker" in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  const cacheNames = "caches" in window ? await caches.keys() : [];
  if (registrations.length === 0 && cacheNames.length === 0) return;

  await Promise.all(registrations.map((registration) => registration.unregister()));
  if ("caches" in window) {
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  }

  if (navigator.serviceWorker.controller) {
    // Still controlled by a stale worker after unregistering — reload so the tab
    // detaches from it. The sessionStorage flag only breaks a reload loop; once
    // we are actually uncontrolled it gets cleared for future sessions.
    if (!sessionStorage.getItem("dev-sw-cleared")) {
      sessionStorage.setItem("dev-sw-cleared", "1");
      window.location.reload();
    } else {
      console.warn("[dev] page is still controlled by a stale service worker — hard-refresh (⇧⌘R) to detach");
    }
  } else {
    sessionStorage.removeItem("dev-sw-cleared");
  }
}

clearDevServiceWorker().catch((error) => {
  console.warn("[dev] failed to clear service worker cache", error);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </React.StrictMode>
);
