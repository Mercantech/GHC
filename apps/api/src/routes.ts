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
  getLatestCommit,
  getOrg,
  getRepo,
  listCommitsSince,
  listOrgRepos,
  parseRepoFullName,
  parseTemplateRepo,
  repoExists,
  slugifyRepoName,
  studentCommitsSinceStart,
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

  /** Repos the current user has accepted via GHC. */
  app.get("/me/repos", async (request) => {
    const enrollments = await prisma.enrollment.findMany({
      where: {
        userId: request.user!.sub,
        status: "active",
        githubRepoFullName: { not: null },
      },
      include: {
        assignment: {
          select: {
            id: true,
            title: true,
            slug: true,
            mode: true,
            org: { select: { name: true, githubOrg: true } },
          },
        },
        group: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return {
      repos: enrollments.map((e) => ({
        enrollmentId: e.id,
        fullName: e.githubRepoFullName!,
        htmlUrl: `https://github.com/${e.githubRepoFullName}`,
        status: e.status,
        acceptedAt: e.updatedAt,
        assignment: {
          id: e.assignment.id,
          title: e.assignment.title,
          slug: e.assignment.slug,
          mode: e.assignment.mode,
          orgName: e.assignment.org.name,
          githubOrg: e.assignment.org.githubOrg,
        },
        groupName: e.group?.name ?? null,
      })),
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

  app.patch("/orgs/:orgId", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const { orgId } = request.params as { orgId: string };
    const body = z
      .object({
        name: z.string().min(1).optional(),
        token: z.string().min(10).optional(),
      })
      .parse(request.body);

    const org = await prisma.org.findFirst({
      where: { id: orgId, createdBySub: request.user!.sub },
    });
    if (!org) return reply.code(404).send({ error: "Org not found" });

    if (body.token) {
      try {
        await getOrg(body.token, org.githubOrg);
      } catch (err) {
        const msg = err instanceof GitHubError ? err.message : "Could not access GitHub org";
        return reply.code(400).send({ error: msg });
      }
    }

    const updated = await prisma.org.update({
      where: { id: org.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.token ? { tokenEncrypted: encryptSecret(body.token) } : {}),
      },
      select: { id: true, name: true, githubOrg: true, createdAt: true },
    });
    return { org: updated };
  });

  app.delete("/orgs/:orgId", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const { orgId } = request.params as { orgId: string };
    const org = await prisma.org.findFirst({
      where: { id: orgId, createdBySub: request.user!.sub },
    });
    if (!org) return reply.code(404).send({ error: "Org not found" });
    await prisma.org.delete({ where: { id: org.id } });
    return reply.code(204).send();
  });

  app.get("/orgs/:orgId/repos", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const { orgId } = request.params as { orgId: string };
    const query = z
      .object({
        q: z.string().optional(),
        templatesOnly: z
          .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
          .optional(),
      })
      .parse(request.query);

    const org = await prisma.org.findFirst({
      where: { id: orgId, createdBySub: request.user!.sub },
    });
    if (!org) return reply.code(404).send({ error: "Org not found" });

    const token = decryptSecret(org.tokenEncrypted);
    let repos = await listOrgRepos(token, org.githubOrg);
    const templatesOnly = query.templatesOnly === "1" || query.templatesOnly === "true";
    if (templatesOnly) repos = repos.filter((r) => r.is_template);
    if (query.q?.trim()) {
      const q = query.q.trim().toLowerCase();
      repos = repos.filter(
        (r) => r.full_name.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
      );
    }
    return {
      repos: repos.map((r) => ({
        fullName: r.full_name,
        name: r.name,
        isTemplate: Boolean(r.is_template),
        htmlUrl: r.html_url,
      })),
      total: repos.length,
    };
  });

  /** Overview of repos created via GHC with last-commit age and activity since start. */
  app.get("/dashboard/repos", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;

    const query = z
      .object({
        orgId: z.string().optional(),
        assignmentId: z.string().optional(),
      })
      .parse(request.query);

    const orgs = await prisma.org.findMany({
      where: {
        createdBySub: request.user!.sub,
        ...(query.orgId ? { id: query.orgId } : {}),
      },
    });
    if (orgs.length === 0) {
      return { repos: [], summary: { total: 0, withActivity: 0, idle: 0, errors: 0 } };
    }

    type RepoRow = {
      fullName: string;
      htmlUrl: string | null;
      assignmentId: string;
      assignmentTitle: string;
      assignmentSlug: string;
      templateRepo: string;
      mode: "individual" | "group";
      orgId: string;
      githubOrg: string;
      groupName: string | null;
      students: string[];
      startedAt: string;
      lastCommitAt: string | null;
      lastCommitMessage: string | null;
      lastCommitAuthor: string | null;
      commitsSinceStart: number;
      hasCommitsSinceStart: boolean;
      error: string | null;
    };

    const pending: Array<{
      fullName: string;
      assignmentId: string;
      assignmentTitle: string;
      assignmentSlug: string;
      templateRepo: string;
      mode: "individual" | "group";
      orgId: string;
      githubOrg: string;
      groupName: string | null;
      students: string[];
      startedAt: Date;
      token: string;
    }> = [];

    for (const org of orgs) {
      let token: string;
      try {
        token = decryptSecret(org.tokenEncrypted);
      } catch {
        continue;
      }

      const assignments = await prisma.assignment.findMany({
        where: {
          orgId: org.id,
          ...(query.assignmentId ? { id: query.assignmentId } : {}),
        },
        include: {
          groups: true,
          enrollments: {
            where: { status: "active", githubRepoFullName: { not: null } },
            include: { user: { select: { githubLogin: true, name: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      for (const assignment of assignments) {
        if (assignment.mode === "group") {
          for (const group of assignment.groups) {
            const members = assignment.enrollments
              .filter((e) => e.groupId === group.id)
              .map((e) => e.user.githubLogin ?? e.user.name ?? "ukendt")
              .filter(Boolean) as string[];
            pending.push({
              fullName: group.githubRepoFullName,
              assignmentId: assignment.id,
              assignmentTitle: assignment.title,
              assignmentSlug: assignment.slug,
              templateRepo: assignment.templateRepo,
              mode: "group",
              orgId: org.id,
              githubOrg: org.githubOrg,
              groupName: group.name,
              students: members,
              startedAt: group.createdAt,
              token,
            });
          }
        } else {
          for (const enrollment of assignment.enrollments) {
            if (!enrollment.githubRepoFullName) continue;
            pending.push({
              fullName: enrollment.githubRepoFullName,
              assignmentId: assignment.id,
              assignmentTitle: assignment.title,
              assignmentSlug: assignment.slug,
              templateRepo: assignment.templateRepo,
              mode: "individual",
              orgId: org.id,
              githubOrg: org.githubOrg,
              groupName: null,
              students: [
                enrollment.user.githubLogin ?? enrollment.user.name ?? "ukendt",
              ],
              startedAt: enrollment.updatedAt,
              token,
            });
          }
        }
      }
    }

    async function enrich(row: (typeof pending)[number]): Promise<RepoRow> {
      const base: RepoRow = {
        fullName: row.fullName,
        htmlUrl: `https://github.com/${row.fullName}`,
        assignmentId: row.assignmentId,
        assignmentTitle: row.assignmentTitle,
        assignmentSlug: row.assignmentSlug,
        templateRepo: row.templateRepo,
        mode: row.mode,
        orgId: row.orgId,
        githubOrg: row.githubOrg,
        groupName: row.groupName,
        students: row.students,
        startedAt: row.startedAt.toISOString(),
        lastCommitAt: null,
        lastCommitMessage: null,
        lastCommitAuthor: null,
        commitsSinceStart: 0,
        hasCommitsSinceStart: false,
        error: null,
      };

      try {
        const { owner, repo } = parseRepoFullName(row.fullName);
        const ghRepo = await getRepo(row.token, owner, repo);
        // Commits efter repo-oprettelse; accept/initial commit filtreres fra.
        const sinceIso = ghRepo.created_at ?? row.startedAt.toISOString();
        const [latest, commits] = await Promise.all([
          getLatestCommit(row.token, owner, repo),
          listCommitsSince(row.token, owner, repo, sinceIso),
        ]);

        const studentCommits = studentCommitsSinceStart(commits, ghRepo.created_at);
        base.htmlUrl = ghRepo.html_url;
        base.commitsSinceStart = studentCommits.length;
        base.hasCommitsSinceStart = studentCommits.length > 0;

        if (latest) {
          base.lastCommitAt =
            latest.commit.committer?.date ?? latest.commit.author?.date ?? null;
          base.lastCommitMessage = latest.commit.message.split("\n")[0] ?? null;
          base.lastCommitAuthor =
            latest.author?.login ?? latest.commit.author?.name ?? null;
        } else if (ghRepo.pushed_at) {
          base.lastCommitAt = ghRepo.pushed_at;
        }
      } catch (err) {
        base.error =
          err instanceof GitHubError ? err.message : "Kunne ikke hente GitHub-aktivitet";
      }

      return base;
    }

    const concurrency = 5;
    const repos: RepoRow[] = [];
    for (let i = 0; i < pending.length; i += concurrency) {
      const chunk = pending.slice(i, i + concurrency);
      repos.push(...(await Promise.all(chunk.map((row) => enrich(row)))));
    }

    repos.sort((a, b) => {
      const aTime = a.lastCommitAt ? new Date(a.lastCommitAt).getTime() : 0;
      const bTime = b.lastCommitAt ? new Date(b.lastCommitAt).getTime() : 0;
      return bTime - aTime;
    });

    return {
      repos,
      summary: {
        total: repos.length,
        withActivity: repos.filter((r) => r.hasCommitsSinceStart).length,
        idle: repos.filter((r) => !r.hasCommitsSinceStart && !r.error).length,
        errors: repos.filter((r) => r.error).length,
      },
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

  app.patch("/rosters/:rosterId", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const { rosterId } = request.params as { rosterId: string };
    const body = z
      .object({
        name: z.string().min(1).optional(),
        csv: z.string().min(1).optional(),
      })
      .parse(request.body);

    const roster = await prisma.roster.findFirst({
      where: { id: rosterId, org: { createdBySub: request.user!.sub } },
    });
    if (!roster) return reply.code(404).send({ error: "Roster not found" });

    if (body.csv) {
      const rows = parseRosterText(body.csv);
      if (rows.length === 0) {
        return reply.code(400).send({ error: "No valid roster rows found" });
      }
      await prisma.$transaction([
        prisma.rosterMember.deleteMany({ where: { rosterId: roster.id } }),
        prisma.rosterMember.createMany({
          data: rows.map((r) => ({
            rosterId: roster.id,
            email: r.email?.toLowerCase(),
            githubLogin: r.githubLogin,
            displayName: r.displayName,
          })),
        }),
        ...(body.name
          ? [prisma.roster.update({ where: { id: roster.id }, data: { name: body.name } })]
          : []),
      ]);
    } else if (body.name) {
      await prisma.roster.update({ where: { id: roster.id }, data: { name: body.name } });
    }

    const updated = await prisma.roster.findUniqueOrThrow({
      where: { id: roster.id },
      include: { _count: { select: { members: true } } },
    });
    return {
      roster: {
        id: updated.id,
        name: updated.name,
        memberCount: updated._count.members,
      },
    };
  });

  app.delete("/rosters/:rosterId", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const { rosterId } = request.params as { rosterId: string };
    const roster = await prisma.roster.findFirst({
      where: { id: rosterId, org: { createdBySub: request.user!.sub } },
      include: { _count: { select: { assignments: true } } },
    });
    if (!roster) return reply.code(404).send({ error: "Roster not found" });
    if (roster._count.assignments > 0) {
      // Detach assignments first then delete
      await prisma.assignment.updateMany({
        where: { rosterId: roster.id },
        data: { rosterId: null, enforceRoster: false },
      });
    }
    await prisma.roster.delete({ where: { id: roster.id } });
    return reply.code(204).send();
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

  app.get("/assignments/manage/:id", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const { id } = request.params as { id: string };
    const assignment = await prisma.assignment.findFirst({
      where: { id, org: { createdBySub: request.user!.sub } },
      include: {
        org: { select: { id: true, name: true, githubOrg: true } },
        _count: { select: { enrollments: true, groups: true } },
        enrollments: {
          include: {
            user: { select: { githubLogin: true, name: true, email: true } },
            group: { select: { id: true, name: true } },
          },
          orderBy: { updatedAt: "desc" },
        },
      },
    });
    if (!assignment) return reply.code(404).send({ error: "Assignment not found" });

    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        slug: assignment.slug,
        mode: assignment.mode,
        templateRepo: assignment.templateRepo,
        inviteToken: assignment.inviteToken,
        maxTeamSize: assignment.maxTeamSize,
        enforceRoster: assignment.enforceRoster,
        rosterId: assignment.rosterId,
        enrollmentCount: assignment._count.enrollments,
        groupCount: assignment._count.groups,
        org: assignment.org,
        createdAt: assignment.createdAt,
        enrollments: assignment.enrollments.map((e) => ({
          id: e.id,
          status: e.status,
          errorMessage: e.errorMessage,
          githubRepoFullName: e.githubRepoFullName,
          acceptedAt: e.updatedAt,
          student: e.user.githubLogin ?? e.user.name ?? e.user.email ?? "ukendt",
          groupName: e.group?.name ?? null,
        })),
      },
    };
  });

  app.patch("/assignments/manage/:id", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const { id } = request.params as { id: string };
    const body = z
      .object({
        title: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        templateRepo: z.string().min(3).optional(),
        maxTeamSize: z.number().int().positive().nullable().optional(),
        enforceRoster: z.boolean().optional(),
        rosterId: z.string().nullable().optional(),
      })
      .parse(request.body);

    const assignment = await prisma.assignment.findFirst({
      where: { id, org: { createdBySub: request.user!.sub } },
    });
    if (!assignment) return reply.code(404).send({ error: "Assignment not found" });

    if (body.templateRepo) {
      try {
        parseTemplateRepo(body.templateRepo);
      } catch {
        return reply.code(400).send({ error: "templateRepo must be owner/repo" });
      }
      try {
        const org = await prisma.org.findUniqueOrThrow({ where: { id: assignment.orgId } });
        const { owner, repo } = parseTemplateRepo(body.templateRepo);
        await getRepo(decryptSecret(org.tokenEncrypted), owner, repo);
      } catch (err) {
        const msg =
          err instanceof GitHubError
            ? `Classroom-org PAT kan ikke læse template “${body.templateRepo}”: ${err.message}`
            : `Kunne ikke tilgå template “${body.templateRepo}”`;
        return reply.code(400).send({ error: msg });
      }
    }

    if (body.rosterId) {
      const roster = await prisma.roster.findFirst({
        where: { id: body.rosterId, orgId: assignment.orgId },
      });
      if (!roster) return reply.code(400).send({ error: "Roster not found for org" });
    }

    let slug = assignment.slug;
    if (body.slug !== undefined) {
      slug = slugify(body.slug);
      if (!slug) return reply.code(400).send({ error: "Invite-slug er ugyldig" });
      const taken = await prisma.assignment.findFirst({
        where: { slug, NOT: { id: assignment.id } },
      });
      if (taken) {
        return reply.code(409).send({ error: `Invite-linket /a/${slug} er allerede i brug` });
      }
    }

    const updated = await prisma.assignment.update({
      where: { id: assignment.id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(body.slug !== undefined ? { slug } : {}),
        ...(body.templateRepo ? { templateRepo: body.templateRepo } : {}),
        ...(body.maxTeamSize !== undefined ? { maxTeamSize: body.maxTeamSize } : {}),
        ...(body.enforceRoster !== undefined ? { enforceRoster: body.enforceRoster } : {}),
        ...(body.rosterId !== undefined ? { rosterId: body.rosterId } : {}),
      },
    });
    return { assignment: updated };
  });

  app.delete("/assignments/manage/:id", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const { id } = request.params as { id: string };
    const assignment = await prisma.assignment.findFirst({
      where: { id, org: { createdBySub: request.user!.sub } },
    });
    if (!assignment) return reply.code(404).send({ error: "Assignment not found" });
    await prisma.assignment.delete({ where: { id: assignment.id } });
    return reply.code(204).send();
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

    // PAT for classroom-org skal kunne læse template (også på tværs af org’er)
    try {
      const { owner, repo } = parseTemplateRepo(body.templateRepo);
      const token = decryptSecret(org.tokenEncrypted);
      await getRepo(token, owner, repo);
    } catch (err) {
      const msg =
        err instanceof GitHubError
          ? `Classroom-org PAT kan ikke læse template “${body.templateRepo}”: ${err.message}. Giv PAT’en læseadgang til template-org’en (fx Mercantech), eller vælg en anden template.`
          : `Kunne ikke tilgå template “${body.templateRepo}” med classroom-org PAT`;
      return reply.code(400).send({ error: msg });
    }

    if (body.rosterId) {
      const roster = await prisma.roster.findFirst({
        where: { id: body.rosterId, orgId: org.id },
      });
      if (!roster) return reply.code(400).send({ error: "Roster not found for org" });
    }

    const requestedSlug = body.slug?.trim();
    let slug: string;
    if (requestedSlug) {
      slug = slugify(requestedSlug);
      if (!slug) {
        return reply.code(400).send({ error: "Invite-slug er ugyldig" });
      }
      const taken = await prisma.assignment.findUnique({ where: { slug } });
      if (taken) {
        return reply.code(409).send({ error: `Invite-linket /a/${slug} er allerede i brug` });
      }
    } else {
      const baseSlug = slugify(body.title);
      slug = baseSlug || `opgave-${randomBytes(3).toString("hex")}`;
      let n = 1;
      while (await prisma.assignment.findUnique({ where: { slug } })) {
        slug = `${baseSlug}-${n++}`;
      }
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
      const existingRepo = await repoExists(token, org.githubOrg, repoName);
      const ghRepo =
        existingRepo ??
        (await generateFromTemplate(token, owner, templateName, {
          owner: org.githubOrg,
          name: repoName,
          private: false,
          description: `${assignment.title} — ${user.githubLogin}`,
        }));
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
      // Hvis template-generate fejlede fordi navnet findes, prøv collaborator alligevel
      if (err instanceof GitHubError && /already exists|name already exists/i.test(msg)) {
        try {
          const existingRepo = await getRepo(token, org.githubOrg, repoName);
          await addCollaborator(token, org.githubOrg, repoName, user.githubLogin!, "push");
          const updated = await prisma.enrollment.update({
            where: { id: enrollment.id },
            data: {
              status: "active",
              githubRepoFullName: existingRepo.full_name,
              errorMessage: null,
            },
          });
          return { enrollment: updated };
        } catch {
          // fall through
        }
      }
      const updated = await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "failed", errorMessage: msg },
      });
      return reply.code(502).send({ error: msg, enrollment: updated });
    }
  });

  /** Teacher: genåbn failed enrollment (re-invite collaborator / genopret). */
  app.post("/enrollments/:enrollmentId/reopen", async (request, reply) => {
    if (!(await requireTeacher(request, reply))) return;
    const { enrollmentId } = request.params as { enrollmentId: string };

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        id: enrollmentId,
        assignment: { org: { createdBySub: request.user!.sub } },
      },
      include: {
        user: true,
        assignment: true,
      },
    });
    if (!enrollment) return reply.code(404).send({ error: "Enrollment not found" });
    if (enrollment.assignment.mode !== "individual") {
      return reply.code(400).send({ error: "Reopen understøttes kun for individuelle assignments" });
    }
    if (!enrollment.user.githubLogin) {
      return reply.code(400).send({ error: "Eleven mangler GitHub-brugernavn" });
    }

    const org = await prisma.org.findUniqueOrThrow({
      where: { id: enrollment.assignment.orgId },
    });
    const token = decryptSecret(org.tokenEncrypted);
    const { owner, repo: templateName } = parseTemplateRepo(enrollment.assignment.templateRepo);
    const repoName = slugifyRepoName(
      `${enrollment.assignment.slug}-${enrollment.user.githubLogin}`,
    );

    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: "pending", errorMessage: null },
    });

    try {
      const existingRepo = await repoExists(token, org.githubOrg, repoName);
      const ghRepo =
        existingRepo ??
        (await generateFromTemplate(token, owner, templateName, {
          owner: org.githubOrg,
          name: repoName,
          private: false,
          description: `${enrollment.assignment.title} — ${enrollment.user.githubLogin}`,
        }));
      await addCollaborator(
        token,
        org.githubOrg,
        repoName,
        enrollment.user.githubLogin,
        "push",
      );
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
      const msg = err instanceof GitHubError ? err.message : "Failed to reopen repo";
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
