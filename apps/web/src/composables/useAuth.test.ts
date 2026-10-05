import { afterEach, expect, it, vi } from "vitest";
import { useAuth } from "./useAuth.js";
import { chatPreferenceKey } from "./chatPreferences.js";
import { listChats, sendMessage } from "../api/client.js";

afterEach(() => vi.unstubAllGlobals());
const alice = { id: "alice-id", login: "alice" };

it("restores a session, handles login errors, registers and clears state only after logout succeeds", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ user: null }))
    .mockResolvedValueOnce(Response.json({ error: "Неверный логин или пароль" }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ user: alice }, { status: 201 }))
    .mockRejectedValueOnce(new Error("Network unavailable"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const auth = useAuth();
  expect(auth.loading.value).toBe(true);
  await auth.restore(); expect(auth.user.value).toBeNull(); expect(auth.loading.value).toBe(false);
  expect(await auth.submit("login", "alice", "wrong-password")).toBe(false);
  expect(auth.error.value).toBe("Неверный логин или пароль");
  expect(await auth.submit("register", "alice", "long-test-password")).toBe(true);
  expect(auth.user.value).toEqual(alice); expect(auth.error.value).toBe("");
  expect(fetch).toHaveBeenCalledWith("/api/auth/register", expect.objectContaining({ credentials: "same-origin", method: "POST", body: JSON.stringify({ login: "alice", password: "long-test-password" }) }));
  expect(await auth.logout()).toBe(false); expect(auth.user.value).toEqual(alice);
  expect(await auth.logout()).toBe(true); expect(auth.user.value).toBeNull();
});

it("restores persisted sessions and reports malformed session responses safely", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ user: alice }))
    .mockResolvedValueOnce(Response.json({ user: { password: "hidden" } })));
  const auth = useAuth(); await auth.restore(); expect(auth.user.value).toEqual(alice);
  await auth.restore(); expect(auth.user.value).toEqual(alice); expect(auth.error.value).not.toBe("");
  expect(JSON.stringify(auth.user.value)).not.toContain("password");
});

it("notifies session expiry for protected JSON and streaming requests", async () => {
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { dispatchEvent });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Login required" }, { status: 401 })));
  await expect(listChats()).rejects.toThrow("Войдите");
  await expect((async () => { for await (const event of sendMessage("c1", "hello")) void event; })()).rejects.toThrow("Войдите");
  expect(dispatchEvent).toHaveBeenCalledTimes(2);
  expect(dispatchEvent.mock.calls[0]![0].type).toBe("agenter:session-expired");
});

it("separates browser drafts for users and the new-chat screen", () => {
  expect(chatPreferenceKey("alice", "c1")).not.toBe(chatPreferenceKey("bob", "c1"));
  expect(chatPreferenceKey("alice", null)).not.toBe(chatPreferenceKey("bob", null));
  expect(chatPreferenceKey("alice", "c1")).toBe("agenter:user:alice:chat:c1");
});

it("does not replace a successful login with a delayed earlier session check", async () => {
  let resolveSession!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(new Promise<Response>(resolve => { resolveSession = resolve; }))
    .mockResolvedValueOnce(Response.json({ user: alice })));
  const auth = useAuth();
  const pending = auth.restore();
  expect(await auth.submit("login", "alice", "long-test-password")).toBe(true);
  resolveSession(Response.json({ user: null })); await pending;
  expect(auth.user.value).toEqual(alice);
});
