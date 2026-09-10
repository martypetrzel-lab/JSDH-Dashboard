import assert from "node:assert/strict";
import { mock, test } from "node:test";

const allowedOrigin = "http://localhost:5173";
process.env.INTEGRATION_ALLOWED_ORIGINS = allowedOrigin;
const databaseCalls = { settings: 0, services: 0 };
const db = {
  settings: {
    findUnique: async () => {
      databaseCalls.settings += 1;
      return null;
    },
  },
  weeklyService: {
    findFirst: async () => {
      databaseCalls.services += 1;
      return null;
    },
  },
};

mock.module("../../lib/prisma.ts", {
  namedExports: { getPrisma: () => db },
});
const { GET, OPTIONS } = await import("../../app/api/integration/current-crew/route.ts");
const { integrationRoute } = await import("../../lib/integration-api.ts");

test("current-crew OPTIONS vrací preflight bez autentizace a databáze", async () => {
  delete process.env.INTEGRATION_API_KEY;
  const response = await OPTIONS(new Request(
    "http://localhost/api/integration/current-crew",
    {
      method: "OPTIONS",
      headers: {
        Origin: allowedOrigin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization, Content-Type",
      },
    },
  ));

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), allowedOrigin);
  assert.match(response.headers.get("Access-Control-Allow-Headers") ?? "", /Authorization/);
  assert.match(response.headers.get("Access-Control-Allow-Methods") ?? "", /GET/);
  assert.match(response.headers.get("Access-Control-Allow-Methods") ?? "", /OPTIONS/);
  assert.equal(response.headers.get("Vary"), "Origin");
  assert.deepEqual(databaseCalls, { settings: 0, services: 0 });
});

test("current-crew GET bez tokenu vrací 401 včetně CORS hlaviček", async () => {
  process.env.INTEGRATION_API_KEY = "integration-test-key";
  const response = await GET(new Request(
    "http://localhost/api/integration/current-crew",
    { headers: { Origin: allowedOrigin } },
  ));

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), allowedOrigin);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.deepEqual(databaseCalls, { settings: 0, services: 0 });
});

test("current-crew GET s platným tokenem funguje beze změny a obsahuje CORS", async () => {
  process.env.INTEGRATION_API_KEY = "integration-test-key";
  const response = await GET(new Request(
    "http://localhost/api/integration/current-crew",
    {
      headers: {
        Origin: allowedOrigin,
        Authorization: "Bearer integration-test-key",
      },
    },
  ));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), allowedOrigin);
  const body = await response.json();
  assert.equal(body.apiVersion, 1);
  assert.equal(body.timezone, "Europe/Prague");
  assert.deepEqual(body.service, null);
  assert.deepEqual(body.currentCrew, []);
  assert.deepEqual(databaseCalls, { settings: 1, services: 1 });
});

test("neočekávaná chyba integračního GET zachová CORS hlavičky", async () => {
  const handler = integrationRoute(async () => {
    throw new Error("Database unavailable");
  });
  const response = await handler(new Request(
    "http://localhost/api/integration/current-crew",
    { headers: { Origin: allowedOrigin } },
  ));

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), allowedOrigin);
  assert.deepEqual(await response.json(), { error: "Internal server error" });
});
