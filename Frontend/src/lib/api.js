import { BACKEND_URL } from "@/config";

async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  githubLoginUrl: () => `${BACKEND_URL}/auth/github`,
  me: () => call("/api/me"),
  logout: () => call("/auth/logout", { method: "POST" }),
  attest: (wallet) => call("/api/attest", { method: "POST", body: { wallet } }),
  sync: () => call("/api/sync", { method: "POST" }),
};
