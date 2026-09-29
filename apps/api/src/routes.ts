import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { resolveIsTeacher } from "./auth.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import { prisma } from "./db.js";
import {
  GitHubError,
  addCollaborator,
  addTeamMembership,
  addTeamRepoPermission,
  createTeam,
  generateFromTemplate,
  getOrg,
  listOrgRepos,
  parseTemplateRepo,
  slugifyRepoName,
} from "./github.js";
import { matchesRoster, parseRosterText } from "./roster.js";
import { requireTeacher } from "./plugins/auth.js";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const routes: FastifyPluginAsync = async (app) => {
  app.get("/me", async (request) => {
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { sub: request.user!.sub } });
    const teacher = await resolveIsTeacher(request.user!, dbUser.githubLogin);
    return {
      sub: dbUser.sub,
      name: dbUser.name,
      email: dbUser.email,
      githubLogin: dbUser.githubLogin,
      githubId: dbUser.githubId,
      roles: request.user!.roles,
      isTeacher: teacher,
    };
  });

  app.patch("/me/github", async (request, reply) => {
    const body = z
      .object({
        githubLogin: z.string().min(1).max(39),
        githubId: z.string().optional(),
      })
      .parse(request.body);

    const user = await prisma.user.update({
      where: { sub: request.user!.sub },
      data: {
        githubLogin: body.githubLogin.replace(/^@/, ""),
        githubId: body.githubId,
      },
    });

    return {
      sub: user.sub,
      githubLogin: user.githubLogin,
      githubId: user.githubId,
    };
  });

  // --- Orgs ---
  app.get("/orgs", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const orgs = await prisma.org.findMany({
      where: { createdBySub: request.user!.sub },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        githubOrg: true,
        createdAt: true,
      },
    });
    return { orgs };
  });

  app.post("/orgs", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const body = z
      .object({
        name: z.string().min(1),
        githubOrg: z.string().min(1),
        token: z.string().min(10),
      })
      .parse(request.body);

    try {
      await getOrg(body.token, body.githubOrg);
    } catch (err) {
      const msg = err instanceof GitHubError ? err.message : "Could not access GitHub org";
      return reply.code(400).send({ error: msg });
    }

    const org = await prisma.org.create({
      data: {
        name: body.name,
        githubOrg: body.githubOrg,
        tokenEncrypted: encryptSecret(body.token),
        createdBySub: request.user!.sub,
      },
      select: { id: true, name: true, githubOrg: true, createdAt: true },
    });

    return reply.code(201).send({ org });
  });

  app.get("/orgs/:orgId/repos", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const { orgId } = request.params as { orgId: string };
    const org = await prisma.org.findFirst({
      where: { id: orgId, createdBySub: request.user!.sub },
    });
    if (!org) return reply.code(404).send({ error: "Org not found" });

    const token = decryptSecret(org.tokenEncrypted);
    const repos = await listOrgRepos(token, org.githubOrg);
    return {
      repos: repos.map((r) => ({
        fullName: r.full_name,
        name: r.name,
        isTemplate: Boolean(r.is_template),
        htmlUrl: r.html_url,
      })),
    };
  });

  // --- Rosters ---
  app.get("/orgs/:orgId/rosters", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const { orgId } = request.params as { orgId: string };
    const org = await prisma.org.findFirst({
      where: { id: orgId, createdBySub: request.user!.sub },
    });
    if (!org) return reply.code(404).send({ error: "Org not found" });

    const rosters = await prisma.roster.findMany({
      where: { orgId },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: "desc" },
    });

    return {
      rosters: rosters.map((r) => ({
        id: r.id,
        name: r.name,
        memberCount: r._count.members,
        createdAt: r.createdAt,
      })),
    };
  });

  app.post("/rosters/import", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const body = z
      .object({
        orgId: z.string().min(1),
        name: z.string().min(1),
        csv: z.string().min(1),
      })
      .parse(request.body);

    const org = await prisma.org.findFirst({
      where: { id: body.orgId, createdBySub: request.user!.sub },
    });
    if (!org) return reply.code(404).send({ error: "Org not found" });

    const rows = parseRosterText(body.csv);
    if (rows.length === 0) {
      return reply.code(400).send({ error: "No valid roster rows found" });
    }

    const roster = await prisma.roster.create({
      data: {
        orgId: org.id,
        name: body.name,
        createdBySub: request.user!.sub,
        members: {
          create: rows.map((r) => ({
            email: r.email?.toLowerCase(),
            githubLogin: r.githubLogin,
            displayName: r.displayName,
          })),
        },
      },
      include: { _count: { select: { members: true } } },
    });

    return reply.code(201).send({
      roster: {
        id: roster.id,
        name: roster.name,
        memberCount: roster._count.members,
      },
    });
  });

  // --- Assignments ---
  app.get("/assignments", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const assignments = await prisma.assignment.findMany({
      where: { org: { createdBySub: request.user!.sub } },
      include: {
        org: { select: { id: true, name: true, githubOrg: true } },
        _count: { select: { enrollments: true, groups: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return {
      assignments: assignments.map((a) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        mode: a.mode,
        templateRepo: a.templateRepo,
        inviteToken: a.inviteToken,
        enrollmentCount: a._count.enrollments,
        groupCount: a._count.groups,
        org: a.org,
        createdAt: a.createdAt,
      })),
    };
  });

  app.post("/assignments", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const body = z
      .object({
        orgId: z.string(),
        rosterId: z.string().optional().nullable(),
        title: z.string().min(1),
        slug: z.string().min(1).optional(),
        templateRepo: z.string().min(3),
        mode: z.enum(["individual", "group"]),
        maxTeamSize: z.number().int().positive().optional().nullable(),
        enforceRoster: z.boolean().optional(),
      })
      .parse(request.body);

    const org = await prisma.org.findFirst({
      where: { id: body.orgId, createdBySub: request.user!.sub },
    });
    if (!org) return reply.code(404).send({ error: "Org not found" });

    try {
      parseTemplateRepo(body.templateRepo);
    } catch {
      return reply.code(400).send({ error: "templateRepo must be owner/repo" });
    }

    if (body.rosterId) {
      const roster = await prisma.roster.findFirst({
        where: { id: body.rosterId, orgId: org.id },
      });
      if (!roster) return reply.code(400).send({ error: "Roster not found for org" });
    }

    const baseSlug = slugify(body.slug ?? body.title);
    let slug = baseSlug;
    let n = 1;
    while (await prisma.assignment.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${n++}`;
    }

    const assignment = await prisma.assignment.create({
      data: {
        orgId: org.id,
        rosterId: body.rosterId ?? null,
        title: body.title,
        slug,
        templateRepo: body.templateRepo,
        mode: body.mode,
        inviteToken: randomBytes(16).toString("hex"),
        maxTeamSize: body.maxTeamSize ?? null,
        enforceRoster: body.enforceRoster ?? Boolean(body.rosterId),
      },
    });

    return reply.code(201).send({ assignment });
  });

  app.get("/assignments/by-invite/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const assignment = await prisma.assignment.findUnique({
      where: { inviteToken: token },
      include: {
        org: { select: { name: true, githubOrg: true } },
        groups: {
          select: {
            id: true,
            name: true,
            githubRepoFullName: true,
            _count: { select: { enrollments: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!assignment) return reply.code(404).send({ error: "Assignment not found" });

    const myEnrollment = await prisma.enrollment.findUnique({
      where: {
        assignmentId_userId: {
          assignmentId: assignment.id,
          userId: request.user!.sub,
        },
      },
    });

    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        slug: assignment.slug,
        mode: assignment.mode,
        templateRepo: assignment.templateRepo,
        maxTeamSize: assignment.maxTeamSize,
        org: assignment.org,
        groups: assignment.groups.map((g) => ({
          id: g.id,
          name: g.name,
          repo: g.githubRepoFullName,
          memberCount: g._count.enrollments,
        })),
      },
      enrollment: myEnrollment,
    };
  });

  app.get("/assignments/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const assignment = await prisma.assignment.findUnique({
      where: { slug },
      include: {
        org: { select: { name: true, githubOrg: true } },
        groups: {
          select: {
            id: true,
            name: true,
            githubRepoFullName: true,
            _count: { select: { enrollments: true } },
          },
        },
      },
    });
    if (!assignment) return reply.code(404).send({ error: "Assignment not found" });

    const myEnrollment = await prisma.enrollment.findUnique({
      where: {
        assignmentId_userId: {
          assignmentId: assignment.id,
          userId: request.user!.sub,
        },
      },
    });

    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        slug: assignment.slug,
        mode: assignment.mode,
        inviteToken: (await resolveIsTeacher(request.user!, (
          await prisma.user.findUnique({ where: { sub: request.user!.sub } })
        )?.githubLogin))
          ? assignment.inviteToken
          : undefined,
        templateRepo: assignment.templateRepo,
        maxTeamSize: assignment.maxTeamSize,
        org: assignment.org,
        groups: assignment.groups.map((g) => ({
          id: g.id,
          name: g.name,
          repo: g.githubRepoFullName,
          memberCount: g._count.enrollments,
        })),
      },
      enrollment: myEnrollment,
    };
  });

  async function assertRosterAllowed(assignmentId: string, userId: string) {
    const assignment = await prisma.assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        roster: { include: { members: true } },
      },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { sub: userId } });

    if (assignment.enforceRoster && assignment.roster) {
      const ok = matchesRoster(assignment.roster.members, user);
      if (!ok) {
        throw Object.assign(new Error("You are not on the roster for this assignment"), {
          statusCode: 403,
        });
      }
    }

    if (!user.githubLogin) {
      throw Object.assign(new Error("Set your GitHub username before accepting"), {
        statusCode: 400,
      });
    }

    return { assignment, user };
  }

  // Individual accept
  app.post("/assignments/:id/accept", async (request, reply) => {
    const { id } = request.params as { id: string };

    let assignment;
    let user;
    try {
      ({ assignment, user } = await assertRosterAllowed(id, request.user!.sub));
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.code(e.statusCode ?? 500).send({ error: e.message });
    }

    if (assignment.mode !== "individual") {
      return reply.code(400).send({ error: "Assignment is not individual mode" });
    }

    const existing = await prisma.enrollment.findUnique({
      where: {
        assignmentId_userId: { assignmentId: assignment.id, userId: user.sub },
      },
    });
    if (existing?.status === "active" && existing.githubRepoFullName) {
      return { enrollment: existing };
    }

    const org = await prisma.org.findUniqueOrThrow({ where: { id: assignment.orgId } });
    const token = decryptSecret(org.tokenEncrypted);
    const { owner, repo: templateName } = parseTemplateRepo(assignment.templateRepo);
    const repoName = slugifyRepoName(`${assignment.slug}-${user.githubLogin}`);

    const enrollment = await prisma.enrollment.upsert({
      where: {
        assignmentId_userId: { assignmentId: assignment.id, userId: user.sub },
      },
      create: {
        assignmentId: assignment.id,
        userId: user.sub,
        status: "pending",
      },
      update: { status: "pending", errorMessage: null },
    });

    try {
      const ghRepo = await generateFromTemplate(token, owner, templateName, {
        owner: org.githubOrg,
        name: repoName,
        private: false,
        description: `${assignment.title} — ${user.githubLogin}`,
      });
      await addCollaborator(token, org.githubOrg, repoName, user.githubLogin!, "push");

      const updated = await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: {
          status: "active",
          githubRepoFullName: ghRepo.full_name,
          errorMessage: null,
        },
      });
      return { enrollment: updated };
    } catch (err) {
      const msg = err instanceof GitHubError ? err.message : "Failed to create repo";
      const updated = await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "failed", errorMessage: msg },
      });
      return reply.code(502).send({ error: msg, enrollment: updated });
    }
  });

  // Group create
  app.post("/assignments/:id/groups", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ name: z.string().min(1).max(64) }).parse(request.body);

    let assignment;
    let user;
    try {
      ({ assignment, user } = await assertRosterAllowed(id, request.user!.sub));
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.code(e.statusCode ?? 500).send({ error: e.message });
    }

    if (assignment.mode !== "group") {
      return reply.code(400).send({ error: "Assignment is not group mode" });
    }

    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        assignmentId_userId: { assignmentId: assignment.id, userId: user.sub },
      },
    });
    if (existingEnrollment?.status === "active") {
      return reply.code(400).send({ error: "You are already enrolled in a group" });
    }

    const existingGroup = await prisma.group.findUnique({
      where: { assignmentId_name: { assignmentId: assignment.id, name: body.name } },
    });
    if (existingGroup) {
      return reply.code(409).send({ error: "Group name already taken" });
    }

    const org = await prisma.org.findUniqueOrThrow({ where: { id: assignment.orgId } });
    const token = decryptSecret(org.tokenEncrypted);
    const { owner, repo: templateName } = parseTemplateRepo(assignment.templateRepo);
    const teamName = `${assignment.slug}-${body.name}`;
    const repoName = slugifyRepoName(teamName);

    try {
      const team = await createTeam(
        token,
        org.githubOrg,
        teamName,
        `GHC group for ${assignment.title}`,
      );
      await addTeamMembership(token, org.githubOrg, team.slug, user.githubLogin!, "maintainer");

      const ghRepo = await generateFromTemplate(token, owner, templateName, {
        owner: org.githubOrg,
        name: repoName,
        private: false,
        description: `${assignment.title} — ${body.name}`,
      });
      await addTeamRepoPermission(token, org.githubOrg, team.slug, org.githubOrg, repoName, "push");

      const group = await prisma.group.create({
        data: {
          assignmentId: assignment.id,
          name: body.name,
          githubTeamSlug: team.slug,
          githubRepoFullName: ghRepo.full_name,
        },
      });

      const enrollment = await prisma.enrollment.upsert({
        where: {
          assignmentId_userId: { assignmentId: assignment.id, userId: user.sub },
        },
        create: {
          assignmentId: assignment.id,
          userId: user.sub,
          groupId: group.id,
          githubRepoFullName: ghRepo.full_name,
          status: "active",
        },
        update: {
          groupId: group.id,
          githubRepoFullName: ghRepo.full_name,
          status: "active",
          errorMessage: null,
        },
      });

      return reply.code(201).send({ group, enrollment });
    } catch (err) {
      const msg = err instanceof GitHubError ? err.message : "Failed to create group";
      return reply.code(502).send({ error: msg });
    }
  });

  // Group join
  app.post("/assignments/:id/groups/:groupId/join", async (request, reply) => {
    const { id, groupId } = request.params as { id: string; groupId: string };

    let assignment;
    let user;
    try {
      ({ assignment, user } = await assertRosterAllowed(id, request.user!.sub));
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.code(e.statusCode ?? 500).send({ error: e.message });
    }

    if (assignment.mode !== "group") {
      return reply.code(400).send({ error: "Assignment is not group mode" });
    }

    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        assignmentId_userId: { assignmentId: assignment.id, userId: user.sub },
      },
    });
    if (existingEnrollment?.status === "active") {
      return reply.code(400).send({ error: "You are already enrolled" });
    }

    const group = await prisma.group.findFirst({
      where: { id: groupId, assignmentId: assignment.id },
      include: { _count: { select: { enrollments: true } } },
    });
    if (!group) return reply.code(404).send({ error: "Group not found" });

    if (assignment.maxTeamSize && group._count.enrollments >= assignment.maxTeamSize) {
      return reply.code(400).send({ error: "Group is full" });
    }

    const org = await prisma.org.findUniqueOrThrow({ where: { id: assignment.orgId } });
    const token = decryptSecret(org.tokenEncrypted);

    try {
      await addTeamMembership(token, org.githubOrg, group.githubTeamSlug, user.githubLogin!, "member");

      const enrollment = await prisma.enrollment.upsert({
        where: {
          assignmentId_userId: { assignmentId: assignment.id, userId: user.sub },
        },
        create: {
          assignmentId: assignment.id,
          userId: user.sub,
          groupId: group.id,
          githubRepoFullName: group.githubRepoFullName,
          status: "active",
        },
        update: {
          groupId: group.id,
          githubRepoFullName: group.githubRepoFullName,
          status: "active",
          errorMessage: null,
        },
      });

      return { group, enrollment };
    } catch (err) {
      const msg = err instanceof GitHubError ? err.message : "Failed to join group";
      return reply.code(502).send({ error: msg });
    }
  });
};
