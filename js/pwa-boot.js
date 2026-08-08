// Start the service-worker install before the main module graph is downloaded.
//
// This file is intentionally a tiny classic script in <head>. Registering only
// after js/main.js had finished booting left a real race on phones: someone
// could add the game to their home screen and close the browser before the
// worker had even begun caching the shell. The next offline launch could then
// draw index.html from the HTTP cache while none of its modules existed, which
// looked like a title screen whose buttons did nothing.
(function startCardEaterPwaInstall() {
  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") return;
  const key = "__cardEaterServiceWorkerRegistration";
  if (!globalThis[key]) {
    globalThis[key] = navigator.serviceWorker.register("./sw.js", {
      scope: "./",
      updateViaCache: "none",
    });
    // Mark the early promise as handled. js/offline.js attaches the user-facing
    // error handling when the game finishes booting.
    globalThis[key].catch(() => null);
  }
}());
