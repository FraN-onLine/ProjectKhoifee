export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
    body:
      options.body instanceof FormData
        ? options.body
        : options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.fields?.length
        ? `Please check: ${data.fields.join(", ")}.`
        : data.error ||
          data.message ||
          `Request failed (${response.status}). Please try again.`,
    );
  return data;
}

export function trackEvent(type, targetId, details = {}) {
  if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true)
    return;
  try {
    let visitId = sessionStorage.getItem("khoifee-visit");
    if (!visitId) {
      visitId = crypto.randomUUID();
      sessionStorage.setItem("khoifee-visit", visitId);
    }
    fetch("/api/events", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, targetId, visitId, ...details }),
    }).catch(() => {});
  } catch {
    // Browsers that block session storage should not be tracked.
  }
}

export function safeLink(value) {
  if (!value) return "";
  try {
    const url = new URL(value, window.location.origin);
    if (
      url.protocol === "https:" ||
      (url.origin === window.location.origin &&
        value.startsWith("/") &&
        !value.startsWith("//"))
    )
      return value;
  } catch {
    return "";
  }
  return "";
}

export function dateLabel(value) {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}
