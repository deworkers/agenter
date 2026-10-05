import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const derive = promisify(scrypt);
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export interface AuthUser { id: string; login: string }
type UserRow = AuthUser & { password_hash: string; salt: string };

export function credentials(input: unknown): { login: string; password: string } {
  const value = input as { login?: unknown; password?: unknown } | null;
  if (!value || typeof value.login !== "string" || typeof value.password !== "string") throw new RangeError("Введите логин и пароль");
  const login = value.login.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(login)) throw new RangeError("Логин: 3–64 символа, латинские буквы, цифры, дефис и подчёркивание");
  if (value.password.length < 8 || value.password.length > 256) throw new RangeError("Пароль: от 8 до 256 символов");
  return { login, password: value.password };
}
function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function publicUser(user: AuthUser): AuthUser { return { id: user.id, login: user.login }; }

export class AuthStore {
  private readonly db: DatabaseSync;
  constructor(file: string, private readonly now: () => number = Date.now) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, salt TEXT NOT NULL,
        legacy_owner INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_legacy_owner ON users(legacy_owner) WHERE legacy_owner = 1;
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);`);
  }
  async register(login: string, password: string): Promise<AuthUser> {
    ({ login, password } = credentials({ login, password }));
    const salt = randomBytes(16).toString("hex");
    const hash = (await derive(password, salt, 64) as Buffer).toString("hex");
    const user = { id: randomUUID(), login };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT id FROM users WHERE login = ?").get(login)) throw new RangeError("Этот логин уже занят");
      const legacyOwner = this.db.prepare("SELECT id FROM users LIMIT 1").get() ? 0 : 1;
      this.db.prepare("INSERT INTO users (id, login, password_hash, salt, legacy_owner) VALUES (?, ?, ?, ?, ?)").run(user.id, login, hash, salt, legacyOwner);
      this.db.exec("COMMIT"); return user;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  async login(login: string, password: string): Promise<AuthUser | undefined> {
    ({ login, password } = credentials({ login, password }));
    const row = this.db.prepare("SELECT * FROM users WHERE login = ?").get(login) as UserRow | undefined;
    // Missing accounts still pay the password derivation cost.
    const hash = await derive(password, row?.salt ?? "agenter-missing-account", 64) as Buffer;
    const expected = row ? Buffer.from(row.password_hash, "hex") : Buffer.alloc(64);
    const matches = timingSafeEqual(hash, expected);
    return row && matches ? publicUser(row) : undefined;
  }
  isLegacyOwner(id: string): boolean {
    return !!this.db.prepare("SELECT id FROM users WHERE id = ? AND legacy_owner = 1").get(id);
  }
  createSession(userId: string): string {
    const token = randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(this.now());
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash(token), userId, this.now() + SESSION_DURATION_MS);
    return token;
  }
  findSession(token: string | undefined): AuthUser | undefined {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
    const user = this.db.prepare(`SELECT users.id, users.login FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE token_hash = ? AND expires_at > ?`).get(tokenHash(token), this.now()) as AuthUser | undefined;
    return user ? publicUser(user) : undefined;
  }
  revokeSession(token: string | undefined): void {
    if (token) this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
  }
  close(): void { this.db.close(); }
}
