import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { authPlugin } from "./plugins/auth.js";
import { routes } from "./routes.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: (origin, cb) => {
    const allowed = (process.env.WEB_ORIGIN ?? "http://localhost:8080")
      .split(",")
      .map((s) => s.trim());
    if (!origin || allowed.includes(origin) || allowed.includes("*")) {
      cb(null, true);
      return;
    }
    cb(null, false);
  },
  credentials: true,
});

await app.register(formbody);

app.get("/health", async () => ({ ok: true, service: "ghc-api" }));

/** Proxy token exchange so browser CORS against auth.mercantec.tech is not required. */
app.post("/oauth/token", async (request, reply) => {
  const tokenUrl =
    process.env.MERCANTEC_TOKEN_URL ?? "https://auth.mercantec.tech/oauth/token";

  let body: URLSearchParams;
  const contentType = String(request.headers["content-type"] ?? "");
  if (contentType.includes("application/x-www-form-urlencoded") && typeof request.body === "string") {
    body = new URLSearchParams(request.body);
  } else if (typeof request.body === "object" && request.body) {
    body = new URLSearchParams();
    for (const [k, v] of Object.entries(request.body as Record<string, unknown>)) {
      if (v != null) body.set(k, String(v));
    }
  } else {
    return reply.code(400).send({ error: "Expected form or JSON body" });
  }

  if (!body.get("client_id")) {
    body.set("client_id", process.env.MERCANTEC_CLIENT_ID ?? "ghc");
  }

  const upstream = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await upstream.text();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return reply.code(upstream.status).send(payload);
});

await app.register(authPlugin);
await app.register(routes);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
