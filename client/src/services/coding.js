const BASE_URL = "http://localhost:5000/api/coding";

async function request(path, options) {
  const response = await fetch(`${BASE_URL}${path}`, options);

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.error || `Coding request failed: ${response.status}`
    );
  }

  return data;
}

export function getCodingStatus() {
  return request("/status");
}

export function getProjects() {
  return request("/projects").then(data => data.projects || []);
}

export function getProject(id) {
  return request(`/projects/${encodeURIComponent(id)}`)
    .then(data => data.project);
}

export function getProjectEntries(id, path = "") {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return request(
    `/projects/${encodeURIComponent(id)}/files${query}`
  );
}

export function getProjectFile(id, path) {
  return request(
    `/projects/${encodeURIComponent(id)}/file` +
    `?path=${encodeURIComponent(path)}`
  );
}

export function startGeneration({ request: prompt, acceptTrustedWorkspaceRisk }) {
  return request("/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      request: prompt,
      acceptTrustedWorkspaceRisk
    })
  }).then(data => data.job);
}

export function getJob(id) {
  return request(`/jobs/${encodeURIComponent(id)}`)
    .then(data => data.job);
}

export function cancelJob(id) {
  return request(`/jobs/${encodeURIComponent(id)}/cancel`, {
    method: "POST"
  }).then(data => data.job);
}
