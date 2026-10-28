import { test, expect } from "@playwright/test";
import { authApi, ApiError, UNREACHABLE_MESSAGE, isUnreachable } from "../../src/lib/api";

/**
 * What a request does when the server doesn't answer (Oct 2026): a read whose
 * connection dropped is tried once more, a write never is, and either way the
 * failure says so in a sentence with status 0, never "Failed to fetch".
 */

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

/** A fetch that fails `drops` times with a dropped connection, then answers. */
function flakyFetch(drops: number, body: unknown) {
  const calls: string[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls.push((init?.method ?? "GET").toUpperCase());
    if (calls.length <= drops) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

test("a read whose connection dropped is tried once more", async () => {
  const calls = flakyFetch(1, { id: 4, name: "Owner" });
  const owner = await authApi.me("token");
  expect(owner).toMatchObject({ id: 4 });
  expect(calls).toEqual(["GET", "GET"]);
});

test("a read that drops twice gives up with a sentence, status 0", async () => {
  const calls = flakyFetch(5, {});
  const err = await authApi.me("token").catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(isUnreachable(err)).toBe(true);
  expect(err.message).toBe(UNREACHABLE_MESSAGE);
  expect(calls).toHaveLength(2);
});

test("a write is never sent twice", async () => {
  const calls = flakyFetch(1, {});
  const err = await authApi.login({ email: "a@b.invalid", password: "x" }).catch((e) => e);
  expect(isUnreachable(err)).toBe(true);
  expect(calls).toEqual(["POST"]);
});

test("a server that answers no is not 'unreachable'", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "That email and password don't match." }), { status: 401 })) as typeof fetch;
  const err = await authApi.login({ email: "a@b.invalid", password: "x" }).catch((e) => e);
  expect(err.status).toBe(401);
  expect(isUnreachable(err)).toBe(false);
});
