import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { AuthStore, SESSION_DURATION_MS } from "./auth.js";

const directories: string[] = [];
const stores: AuthStore[] = [];
afterEach(() => {
  stores.splice(0).forEach(store => store.close());
  directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
});
function database(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "agenter-auth-")); directories.push(directory);
  return path.join(directory, "auth.db");
}
function open(file: string, now?: () => number): AuthStore {
  const store = new AuthStore(file, now); stores.push(store); return store;
}

it("normalizes unique logins, hashes credentials and sessions, and persists the legacy owner", async () => {
  const file = database();
  const store = open(file);
  const alice = await store.register(" Alice ", "long-test-password");
  const bob = await store.register("bob", "other-test-password");
  expect(alice.login).toBe("alice");
  expect(store.isLegacyOwner(alice.id)).toBe(true);
  expect(store.isLegacyOwner(bob.id)).toBe(false);
  await expect(store.register("ALICE", "long-test-password")).rejects.toThrow("занят");
  expect(await store.login("ALICE", "long-test-password")).toEqual(alice);
  expect(await store.login("alice", "wrong-password")).toBeUndefined();
  expect(await store.login("missing", "long-test-password")).toBeUndefined();
  const token = store.createSession(alice.id);
  expect(store.findSession(token)).toEqual(alice);
  const db = new DatabaseSync(file);
  try {
    const stored = JSON.stringify([db.prepare("SELECT * FROM users").all(), db.prepare("SELECT * FROM sessions").all()]);
    expect(stored).not.toContain("long-test-password"); expect(stored).not.toContain(token);
    expect(JSON.stringify(alice)).not.toMatch(/hash|salt|password/);
  } finally { db.close(); }
  store.close(); stores.splice(stores.indexOf(store), 1);
  const restarted = open(file);
  expect(restarted.findSession(token)).toEqual(alice);
  expect(restarted.isLegacyOwner(alice.id)).toBe(true);
  expect(await restarted.login("bob", "other-test-password")).toEqual(bob);
  restarted.revokeSession(token);
  expect(restarted.findSession(token)).toBeUndefined();
});

it("rejects invalid credentials before hashing and expires sessions", async () => {
  let now = 1000;
  const store = open(database(), () => now);
  for (const login of ["", "../alice", "x".repeat(65), "ab"]) await expect(store.register(login, "long-test-password")).rejects.toThrow();
  for (const password of ["short", "x".repeat(257)]) await expect(store.register("alice", password)).rejects.toThrow();
  const user = await store.register("alice", "long-test-password");
  const token = store.createSession(user.id);
  expect(store.findSession("invalid-token")).toBeUndefined();
  now += SESSION_DURATION_MS;
  expect(store.findSession(token)).toBeUndefined();
});
