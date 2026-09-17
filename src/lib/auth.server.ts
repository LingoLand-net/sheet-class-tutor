const SECRET_ENV = "SESSION_SECRET";
const ADMIN_PIN_ENV = "ADMIN_PIN";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

function secret(): string | undefined {
  return process.env[SECRET_ENV];
}

function adminPin(): string | undefined {
  return process.env[ADMIN_PIN_ENV];
}

export function authConfigured(): boolean {
  return Boolean(secret() && adminPin());
}

/* ---------- Rate limiting (single-key, single-user app) ---------- */

type RateEntry = { failures: number; lockedUntil: number };
const rateLimitStore = new Map<string, RateEntry>();

export function rateLimitStatus(): { locked: boolean; retryAfterSec: number } {
  const entry = rateLimitStore.get("admin");
  if (!entry) return { locked: false, retryAfterSec: 0 };
  if (entry.lockedUntil > Date.now()) {
    return {
      locked: true,
      retryAfterSec: Math.ceil((entry.lockedUntil - Date.now()) / 1000),
    };
  }
  if (entry.lockedUntil > 0 && entry.lockedUntil <= Date.now()) {
    rateLimitStore.delete("admin");
  }
  return { locked: false, retryAfterSec: 0 };
}

export function recordFailedAttempt(): void {
  const entry = rateLimitStore.get("admin") ?? { failures: 0, lockedUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = Date.now() + RATE_WINDOW_MS;
    entry.failures = 0;
  }
  rateLimitStore.set("admin", entry);
}

export function clearFailedAttempts(): void {
  rateLimitStore.delete("admin");
}

/* ---------- HMAC token signing ---------- */

let keyCache: CryptoKey | undefined;

async function hmacKey(): Promise<CryptoKey> {
  if (keyCache) return keyCache;
  const s = secret();
  if (!s) throw new Error("SESSION_SECRET not configured");
  keyCache = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(s),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return keyCache;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function stringToBase64Url(input: string): string {
  return bytesToBase64Url(new TextEncoder().encode(input));
}

function base64UrlToBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function issueToken(): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payloadB64 = stringToBase64Url(JSON.stringify({ exp: expiresAt, iat: Date.now() }));
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const token = `${payloadB64}.${bytesToBase64Url(new Uint8Array(sig))}`;
  return { token, expiresAt };
}

export async function verifyToken(token: string): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const payloadB64 = parts[0]!;
  const sigB64 = parts[1]!;
  try {
    const key = await hmacKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(sigB64),
      new TextEncoder().encode(payloadB64),
    );
    if (!ok) return false;
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payloadB64)),
    ) as { exp?: number };
    if (typeof payload.exp !== "number") return false;
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

/** Constant-time string comparison to avoid timing leaks on PIN length. */
export function verifyPin(pin: string): boolean {
  const expected = adminPin();
  if (!expected) return false;
  if (pin.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < pin.length; i++) {
    diff |= pin.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Thrown when a data function is called without a valid token. */
export class UnauthorizedError extends Error {
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}