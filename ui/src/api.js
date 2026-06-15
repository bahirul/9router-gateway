let csrfToken = "";
let authGeneration = 0;
let unauthorizedGeneration = null;
let unauthorizedHandler = null;

export function setCsrfToken(value) {
  csrfToken = value || "";
  authGeneration += 1;
  unauthorizedGeneration = null;
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

export async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };
  const requestGeneration = authGeneration;
  const { skipUnauthorized = false, ...fetchOptions } = options;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method) && csrfToken) headers["x-csrf-token"] = csrfToken;
  const response = await fetch(path, {
    ...fetchOptions,
    headers,
    credentials: "same-origin",
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    if (
      response.status === 401
      && !skipUnauthorized
      && requestGeneration === authGeneration
      && unauthorizedGeneration !== requestGeneration
    ) {
      unauthorizedGeneration = requestGeneration;
      csrfToken = "";
      unauthorizedHandler?.();
    }
    const error = new Error(payload?.error || `Request failed with ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}
