import { createServer } from "vite";
import { createApp } from "../server/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const apiPort = Number(process.env.DEV_API_PORT || 3001);
const webPort = Number(process.env.DEV_WEB_PORT || 5173);

if (
  !Number.isInteger(apiPort) ||
  !Number.isInteger(webPort) ||
  apiPort < 1 ||
  apiPort > 65535 ||
  webPort < 1 ||
  webPort > 65535
) {
  throw new Error("DEV_API_PORT and DEV_WEB_PORT must be valid TCP ports.");
}

function listenAvailable(app, initialPort) {
  return new Promise((resolve, reject) => {
    let port = initialPort;
    const listen = () => {
      const server = app.listen(port, "127.0.0.1");
      server.once("listening", () => resolve(server));
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE" && port < 65535) {
          console.info(`Port ${port} is already in use; trying ${port + 1}.`);
          port += 1;
          listen();
          return;
        }
        reject(error);
      });
    };
    listen();
  });
}

const app = createApp({
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(root, "data"),
  bootstrapToken: process.env.BOOTSTRAP_TOKEN,
  production: false,
});
let apiServer;
let vite;
try {
  apiServer = await listenAvailable(app, apiPort);
  process.env.KHOIFEE_API_TARGET = `http://127.0.0.1:${apiServer.address().port}`;
  vite = await createServer({
    configFile: path.join(root, "vite.config.js"),
    server: { host: "127.0.0.1", port: webPort },
  });
  await vite.listen();
  console.info(`Open your site at ${vite.resolvedUrls.local[0]}`);
  console.info("Press Ctrl+C to stop the server.");
} catch (error) {
  await vite?.close();
  if (apiServer?.listening)
    await new Promise((resolve) => apiServer.close(resolve));
  app.locals.close();
  throw error;
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await vite.close();
  await new Promise((resolve) => apiServer.close(resolve));
  app.locals.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
