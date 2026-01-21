// src/api.ts
// Automatically detect backend URL depending on where frontend is running
const hostname = window.location.hostname;

// ✅ Detect Codespaces environment dynamically
let API_BASE: string;

if (hostname.includes("app.github.dev")) {
  // If we’re in GitHub Codespaces: replace the frontend port (3000) with backend port (4000)
  API_BASE = `https://${hostname.replace("-3000", "-4000")}`;
} else {
  // Default for local or production builds
  API_BASE = "http://localhost:4000";
}

export { API_BASE };

// change to your actual backend URL (and later your LAN IP)

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  if (res.status === 204) return null;
  return await res.json();
}

// === Materials CRUD ===

export const api = {
  getItems: () => request("/items"),
  getItem: (id: number) => request(`/items/${id}`),
  createItem: (data: { name: string; sku?: string; quantity: number; price?: number; category?: string }) =>
    request("/items", { method: "POST", body: JSON.stringify(data) }),
  updateItem: (id: number, data: any) =>
    request(`/items/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteItem: (id: number) => request(`/items/${id}`, { method: "DELETE" }),
  adjustItem: (id: number, delta: number, reason?: string, user?: string) =>
    request(`/items/${id}/adjust`, {
      method: "PATCH",
      body: JSON.stringify({ delta, reason, user }),
    }),
  getTransactions: () => request("/transactions"),
};
