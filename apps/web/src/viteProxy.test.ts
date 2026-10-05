import { createServer as createHttpServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { expect, it } from "vitest";
import config from "../vite.config.js";

it("preserves the browser Host and Origin through the actual development API proxy", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "agenter-proxy-"));
  const backend = createHttpServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin, path: req.url }));
  });
  backend.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => backend.once("listening", resolve));
  const address = backend.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  const target = `http://127.0.0.1:${address.port}`;
  const apiProxy = config.server?.proxy?.["/api"];
  const vite = await createViteServer({
    ...config, configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), cacheDir: directory,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      ...config.server, host: "127.0.0.1", port: 0, hmr: false, watch: null,
      proxy: { "/api": typeof apiProxy === "string" ? target : { ...apiProxy, target } },
    },
  });
  try {
    await vite.listen();
    const frontend = vite.httpServer?.address();
    if (!frontend || typeof frontend === "string") throw new Error("Expected Vite TCP address");
    const origin = `http://localhost:${frontend.port}`;
    const response = await fetch(`${origin}/api/auth/login`, {
      method: "POST", headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: "{}",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ host: new URL(origin).host, origin, path: "/api/auth/login" });
  } finally {
    await vite.close();
    await new Promise<void>(resolve => backend.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
