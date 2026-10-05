import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "./application.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
if (process.env.AUTH_COOKIE_SECURE !== undefined && !["true", "false"].includes(process.env.AUTH_COOKIE_SECURE)) {
  throw new Error("AUTH_COOKIE_SECURE должен быть true или false");
}
const application = await createApplication({
  configDirectory: path.resolve(directory, "../../../config"),
  skillsDirectory: path.resolve(directory, "../../../skills"),
  dbPath: process.env.DB_PATH ?? "./data/agenter.db",
  secureCookies: process.env.AUTH_COOKIE_SECURE === "true",
});
const port = Number(process.env.PORT ?? "3000");
const server = application.app.listen(port, () => console.log(`agenter api listening on http://localhost:${port}`));
// Drain HTTP turns before closing databases used by their runtime snapshots.
let shutdown: Promise<void> | undefined;
function close(): Promise<void> {
  shutdown ??= new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())).then(() => application.close());
  return shutdown;
}
process.once("SIGINT", () => { void close().catch(() => undefined); });
process.once("SIGTERM", () => { void close().catch(() => undefined); });
