/** Registers the production service worker without interfering with Vite HMR. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener(
    "load",
    () => {
      const baseUrl = import.meta.env.BASE_URL;
      void navigator.serviceWorker
        .register(`${baseUrl}sw.js`, { scope: baseUrl })
        .then((registration) => {
          void registration.update();
        })
        .catch((error: unknown) => {
          console.warn("Nomio offline support could not start", error);
        });
    },
    { once: true },
  );
}
