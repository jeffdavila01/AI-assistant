const BASE = "http://localhost:5000/api/memory";

async function request(path = "", method = "GET", body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    ...(body !== undefined
      ? { body: JSON.stringify(body) }
      : {})
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error || "Memory operation failed."
    );
  }

  return data;
}

export const memoryAPI = {
  list: () => request(),

  add: (content, category) =>
    request("", "POST", { content, category }),

  update: (id, content, category) =>
    request(`/${encodeURIComponent(id)}`, "PATCH", {
      content,
      category
    }),

  remove: id =>
    request(`/${encodeURIComponent(id)}`, "DELETE"),

  clear: () =>
    request("/all", "DELETE"),

  setEnabled: enabled =>
    request("/settings", "PATCH", { enabled })
};
