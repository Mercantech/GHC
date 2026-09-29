export class GitHubError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.body = body;
  }
}

type GhOptions = {
  token: string;
  method?: string;
  body?: unknown;
  accept?: string;
};

async function ghFetch<T>(path: string, opts: GhOptions): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Accept: opts.accept ?? "application/vnd.github+json",
      Authorization: `Bearer ${opts.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GHC-Mercantec",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "message" in data
        ? String((data as { message: string }).message)
        : `GitHub API ${res.status}`;
    throw new GitHubError(msg, res.status, data);
  }

  return data as T;
}

export type GitHubUser = {
  login: string;
  id: number;
};

export type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  is_template?: boolean;
};

export type GitHubOrg = {
  login: string;
  id: number;
};

export type GitHubTeam = {
  id: number;
  name: string;
  slug: string;
};

export async function getAuthenticatedUser(token: string): Promise<GitHubUser> {
  return ghFetch<GitHubUser>("/user", { token });
}

export async function getOrg(token: string, org: string): Promise<GitHubOrg> {
  return ghFetch<GitHubOrg>(`/orgs/${encodeURIComponent(org)}`, { token });
}

export async function listOrgRepos(token: string, org: string): Promise<GitHubRepo[]> {
  return ghFetch<GitHubRepo[]>(
    `/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=updated`,
    { token },
  );
}

export async function generateFromTemplate(
  token: string,
  templateOwner: string,
  templateRepo: string,
  opts: { owner: string; name: string; private?: boolean; description?: string },
): Promise<GitHubRepo> {
  return ghFetch<GitHubRepo>(
    `/repos/${encodeURIComponent(templateOwner)}/${encodeURIComponent(templateRepo)}/generate`,
    {
      token,
      method: "POST",
      body: {
        owner: opts.owner,
        name: opts.name,
        private: opts.private ?? false,
        description: opts.description,
        include_all_branches: false,
      },
    },
  );
}

export async function addCollaborator(
  token: string,
  owner: string,
  repo: string,
  username: string,
  permission: "pull" | "triage" | "push" | "maintain" | "admin" = "push",
): Promise<void> {
  await ghFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}`,
    {
      token,
      method: "PUT",
      body: { permission },
    },
  );
}

export async function createTeam(
  token: string,
  org: string,
  name: string,
  description?: string,
): Promise<GitHubTeam> {
  return ghFetch<GitHubTeam>(`/orgs/${encodeURIComponent(org)}/teams`, {
    token,
    method: "POST",
    body: {
      name,
      description,
      privacy: "closed",
    },
  });
}

export async function addTeamMembership(
  token: string,
  org: string,
  teamSlug: string,
  username: string,
  role: "member" | "maintainer" = "member",
): Promise<void> {
  await ghFetch(
    `/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(teamSlug)}/memberships/${encodeURIComponent(username)}`,
    {
      token,
      method: "PUT",
      body: { role },
    },
  );
}

export async function addTeamRepoPermission(
  token: string,
  org: string,
  teamSlug: string,
  owner: string,
  repo: string,
  permission: "pull" | "push" | "admin" = "push",
): Promise<void> {
  await ghFetch(
    `/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(teamSlug)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      token,
      method: "PUT",
      body: { permission },
    },
  );
}

export function slugifyRepoName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

export function parseTemplateRepo(fullName: string): { owner: string; repo: string } {
  const parts = fullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("template_repo must be owner/repo");
  }
  return { owner: parts[0], repo: parts[1] };
}
