import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { resolveIsTeacher, verifyAccessToken, type AuthUser } from "../auth.js";
import { prisma } from "../db.js";

const authPluginImpl: FastifyPluginAsync = async (app) => {
  app.decorateRequest("user", null as unknown as AuthUser | undefined);

  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (path === "/health" || path === "/oauth/token") {
      return;
    }

    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing Bearer token" });
    }

    try {
      const user = await verifyAccessToken(header.slice(7));
      request.user = user;

      await prisma.user.upsert({
        where: { sub: user.sub },
        create: {
          sub: user.sub,
          name: user.name,
          email: user.email,
        },
        update: {
          name: user.name,
          email: user.email,
        },
      });
    } catch (err) {
      request.log.warn({ err }, "JWT validation failed");
      return reply.code(401).send({ error: "Invalid token" });
    }
  });
};

/** Break Fastify encapsulation so the JWT hook applies to all routes. */
export const authPlugin = fp(authPluginImpl, {
  name: "ghc-auth",
});

export async function requireTeacher(
  request: { user?: AuthUser },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): Promise<boolean> {
  if (!request.user) {
    reply.code(403).send({ error: "Teacher role required" });
    return false;
  }
  const dbUser = await prisma.user.findUnique({ where: { sub: request.user.sub } });
  const ok = await resolveIsTeacher(request.user, dbUser?.githubLogin);
  if (!ok) {
    reply.code(403).send({ error: "Teacher role required" });
    return false;
  }
  return true;
}
