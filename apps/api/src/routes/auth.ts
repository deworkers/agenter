import { Router, type CookieOptions, type Request, type RequestHandler } from "express";
import { AuthStore, credentials, SESSION_DURATION_MS } from "../auth.js";

const COOKIE_NAME = "agenter_session";
export function sessionToken(req: Request): string | undefined {
  return req.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
}
export const sameOrigin: RequestHandler = (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  const origin = req.get("origin");
  let crossOrigin = req.get("sec-fetch-site") === "cross-site";
  if (origin) {
    try {
      const url = new URL(origin);
      crossOrigin ||= !["http:", "https:"].includes(url.protocol) || url.host !== req.get("host");
    } catch { crossOrigin = true; }
  }
  if (crossOrigin) { res.status(403).json({ error: "Запрос с другого сайта запрещён" }); return; }
  if (["POST", "PUT", "PATCH"].includes(req.method) && !req.is("application/json")) { res.status(415).json({ error: "Ожидается application/json" }); return; }
  next();
};

export function createAuthRouter(store: AuthStore, secureCookies = false): Router {
  const router = Router();
  const options: CookieOptions = { httpOnly: true, sameSite: "strict", secure: secureCookies, path: "/api" };
  const attempts = new Map<string, { count: number; until: number }>();
  const windowMs = 15 * 60 * 1000;
  let inFlight = 0;
  const limit: RequestHandler = (req, res, next) => {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    const key = req.ip ?? "unknown";
    const entry = attempts.get(key) ?? { count: 0, until: now + windowMs };
    if (entry.count >= 20 || inFlight >= 4 || (!attempts.has(key) && attempts.size >= 10_000)) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.until - now) / 1000))));
      res.status(429).json({ error: "Слишком много попыток. Попробуйте позже." }); return;
    }
    entry.count++; attempts.set(key, entry); next();
  };
  router.get("/session", (req, res) => res.json({ user: store.findSession(sessionToken(req)) ?? null }));
  for (const action of ["register", "login"] as const) {
    router.post(`/${action}`, limit, async (req, res) => {
      inFlight++;
      try {
        const { login, password } = credentials(req.body);
        const user = await store[action](login, password);
        if (!user) { res.status(401).json({ error: "Неверный логин или пароль" }); return; }
        store.revokeSession(sessionToken(req));
        res.cookie(COOKIE_NAME, store.createSession(user.id), { ...options, maxAge: SESSION_DURATION_MS });
        res.status(action === "register" ? 201 : 200).json({ user });
      } catch (error) {
        res.status(error instanceof RangeError ? (error.message.includes("занят") ? 409 : 400) : 500)
          .json({ error: error instanceof RangeError ? error.message : "Не удалось выполнить вход" });
      } finally { inFlight--; }
    });
  }
  router.post("/logout", (req, res) => {
    store.revokeSession(sessionToken(req)); res.clearCookie(COOKIE_NAME, options); res.status(204).end();
  });
  return router;
}
