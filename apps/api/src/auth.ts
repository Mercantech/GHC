import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { prisma } from "./db.js";

export type AuthUser = {
  sub: string;
  name?: string;
  email?: string;
  roles: string[];
  loginMethod?: string;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    const url = process.env.MERCANTEC_JWKS_URL ?? "https://auth.mercantec.tech/.well-known/jwks.json";
    jwks = createRemoteJWKSet(new URL(url));
  }
  return jwks;
}

function extractRoles(payload: JWTPayload): string[] {
  const role = payload.role;
  if (Array.isArray(role)) {
    return role.map(String);
  }
  if (typeof role === "string") {
    return [role];
  }
  const msRole = payload["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"];
  if (Array.isArray(msRole)) {
    return msRole.map(String);
  }
  if (typeof msRole === "string") {
    return [msRole];
  }
  return [];
}

export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const issuer = process.env.MERCANTEC_ISSUER ?? "https://auth.mercantec.tech";
  const audience = process.env.MERCANTEC_AUDIENCE ?? "mercantec-apps";

  const { payload } = await jwtVerify(token, getJwks(), {
    issuer,
    audience,
    algorithms: ["RS256"],
  });

  if (!payload.sub) {
    throw new Error("Token missing sub");
  }

  return {
    sub: payload.sub,
    name: typeof payload.name === "string" ? payload.name : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    roles: extractRoles(payload),
    loginMethod: typeof payload.login_method === "string" ? payload.login_method : undefined,
  };
}

export function teacherRoles(): string[] {
  return (process.env.TEACHER_ROLES ?? "teacher,admin")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

export function hasTeacherRole(user: AuthUser): boolean {
  const allowed = new Set(teacherRoles());
  return user.roles.some((r) => allowed.has(r));
}

export async function resolveIsTeacher(
  user: AuthUser,
  githubLogin?: string | null,
): Promise<boolean> {
  if (hasTeacherRole(user)) return true;

  const login = githubLogin?.replace(/^@/, "").trim();
  const or: Array<{ githubLogin?: { equals: string; mode: "insensitive" }; email?: { equals: string; mode: "insensitive" } }> = [];
  if (login) {
    or.push({ githubLogin: { equals: login, mode: "insensitive" } });
  }
  if (user.email) {
    or.push({ email: { equals: user.email, mode: "insensitive" } });
  }
  if (or.length === 0) return false;

  const hit = await prisma.teacherAllowlist.findFirst({ where: { OR: or } });
  return Boolean(hit);
}
