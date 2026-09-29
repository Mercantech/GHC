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

async function ghFetch<T>(pathOrUrl: string, opts: GhOptions): Promise<T> {
  const { data } = await ghFetchWithMeta<T>(pathOrUrl, opts);
  return data;
}

async function ghFetchWithMeta<T>(
  pathOrUrl: string,
  opts: GhOptions,
): Promise<{ data: T; link: string | null }> {
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `https://api.github.com${pathOrUrl}`;
  const res = await fetch(url, {
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

  return { data: data as T, link: res.headers.get("link") };
}

function nextLinkFromHeader(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/<([^>]+)>\s*;\s*rel="next"/i);
  return match?.[1] ?? null;
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
  created_at?: string;
  pushed_at?: string;
  default_branch?: string;
};

export type GitHubCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
    committer: { name: string; date: string } | null;
  };
  author: { login: string } | null;
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
  return listAllOrgRepos(token, org);
}

/** Henter alle org-repos via pagination (GitHub max 100/side). */
export async function listAllOrgRepos(token: string, org: string): Promise<GitHubRepo[]> {
  const all: GitHubRepo[] = [];
  let next: string | null =
    `/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=full_name&direction=asc&type=all`;
  let guard = 0;
  while (next && guard < 50) {
    guard += 1;
    const { data, link } = await ghFetchWithMeta<GitHubRepo[]>(next, { token });
    all.push(...data);
    next = nextLinkFromHeader(link);
  }
  return all;
}

export async function repoExists(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubRepo | null> {
  try {
    return await getRepo(token, owner, repo);
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null;
    throw err;
  }
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

export async function getRepo(token: string, owner: string, repo: string): Promise<GitHubRepo> {
  return ghFetch<GitHubRepo>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { token },
  );
}

export async function getLatestCommit(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubCommit | null> {
  const commits = await ghFetch<GitHubCommit[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=1`,
    { token },
  );
  return commits[0] ?? null;
}

/** Commits with author date >= since (typically student work after repo creation). */
export async function listCommitsSince(
  token: string,
  owner: string,
  repo: string,
  since: string,
  perPage = 100,
): Promise<GitHubCommit[]> {
  return ghFetch<GitHubCommit[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?since=${encodeURIComponent(since)}&per_page=${perPage}`,
    { token },
  );
}

export function parseRepoFullName(fullName: string): { owner: string; repo: string } {
  const parts = fullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("repo must be owner/repo");
  }
  return { owner: parts[0], repo: parts[1] };
}

/** Accept/template bootstrap — tæller ikke som elev-aktivitet. */
const BOOTSTRAP_COMMIT_RE = /^(initial commit|create .* from .*template|first commit)\b/i;
const BOOTSTRAP_WINDOW_MS = 2 * 60 * 1000;

export function isBootstrapCommit(commit: GitHubCommit, repoCreatedAt?: string | null): boolean {
  const subject = (commit.commit.message.split("\n")[0] ?? "").trim();
  if (BOOTSTRAP_COMMIT_RE.test(subject)) return true;
  if (!repoCreatedAt) return false;
  const created = new Date(repoCreatedAt).getTime();
  if (Number.isNaN(created)) return false;
  const dateRaw = commit.commit.committer?.date ?? commit.commit.author?.date;
  if (!dateRaw) return false;
  const commitTime = new Date(dateRaw).getTime();
  return Math.abs(commitTime - created) <= BOOTSTRAP_WINDOW_MS;
}

export function studentCommitsSinceStart(
  commits: GitHubCommit[],
  repoCreatedAt?: string | null,
): GitHubCommit[] {
  return commits.filter((c) => !isBootstrapCommit(c, repoCreatedAt));
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
