import "./style.css";
import { NomioApplication } from "./app/application";
import { registerServiceWorker } from "./app/pwa";

registerServiceWorker();

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("#app not found");
}

const application = new NomioApplication({ root });
application.start();
