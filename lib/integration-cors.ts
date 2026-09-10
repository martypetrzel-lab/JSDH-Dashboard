const DEFAULT_INTEGRATION_ALLOWED_ORIGINS = ["http://localhost:5173"];

export function integrationAllowedOrigins(value = process.env.INTEGRATION_ALLOWED_ORIGINS) {
  const origins = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins?.length ? origins : DEFAULT_INTEGRATION_ALLOWED_ORIGINS;
}

export function integrationCorsHeaders(request: Request) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  const origin = request.headers.get("Origin");

  if (origin && integrationAllowedOrigins().includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

export function integrationResponseHeaders(request: Request) {
  const headers = integrationCorsHeaders(request);
  headers.set("Cache-Control", "no-store");
  return headers;
}

export function integrationOptions(request: Request) {
  return new Response(null, {
    status: 204,
    headers: integrationCorsHeaders(request),
  });
}
