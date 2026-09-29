import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Field, Layout, RequireTeacher, type Me } from "../components";
import { CopyIcon, GitHubMark } from "../icons";

type Org = { id: string; name: string; githubOrg: string };
type Roster = { id: string; name: string; memberCount: number };
type Assignment = {
  id: string;
  title: string;
  slug: string;
  mode: "individual" | "group";
  templateRepo: string;
  inviteToken: string;
  enrollmentCount: number;
  groupCount: number;
  org: Org;
};
type Repo = { fullName: string; name: string; isTemplate: boolean };

type DashboardRepo = {
  fullName: string;
  htmlUrl: string | null;
  assignmentId: string;
  assignmentTitle: string;
  mode: "individual" | "group";
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

type DashboardSummary = {
  total: number;
  withActivity: number;
  idle: number;
  errors: number;
};

const webOrigin = import.meta.env.VITE_WEB_ORIGIN ?? window.location.origin;

function slugifyInvite(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function formatRelativeDa(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return "lige nu";
  const mins = Math.round(diffSec / 60);
  if (mins < 60) return `${mins} min. siden`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} t. siden`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} dage siden`;
  const months = Math.round(days / 30);
  return `${months} mdr. siden`;
}

export function TeacherPage({ me }: { me: Me | null }) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [dashboardRepos, setDashboardRepos] = useState<DashboardRepo[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardFilter, setDashboardFilter] = useState<"all" | "active" | "idle">("all");

  const [orgName, setOrgName] = useState("");
  const [githubOrg, setGithubOrg] = useState("");
  const [token, setToken] = useState("");

  const [rosterName, setRosterName] = useState("");
  const [csv, setCsv] = useState("email,github,name\n");

  const [title, setTitle] = useState("");
  const [inviteSlug, setInviteSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [templateRepo, setTemplateRepo] = useState("");
  const [mode, setMode] = useState<"individual" | "group">("individual");
  const [rosterId, setRosterId] = useState("");
  const [maxTeamSize, setMaxTeamSize] = useState("");

  async function load() {
    setError(null);
    const [orgRes, asgRes] = await Promise.all([
      api<{ orgs: Org[] }>("/orgs"),
      api<{ assignments: Assignment[] }>("/assignments"),
    ]);
    setOrgs(orgRes.orgs);
    setAssignments(asgRes.assignments);
    if (!selectedOrg && orgRes.orgs[0]) {
      setSelectedOrg(orgRes.orgs[0].id);
    }
  }

  async function loadDashboard(orgId: string) {
    if (!orgId) {
      setDashboardRepos([]);
      setDashboardSummary(null);
      return;
    }
    setDashboardLoading(true);
    try {
      const res = await api<{ repos: DashboardRepo[]; summary: DashboardSummary }>(
        `/dashboard/repos?orgId=${encodeURIComponent(orgId)}`,
      );
      setDashboardRepos(res.repos);
      setDashboardSummary(res.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke hente repo-oversigt");
    } finally {
      setDashboardLoading(false);
    }
  }

  useEffect(() => {
    if (me?.isTeacher) {
      void load().catch((e) => setError(e instanceof Error ? e.message : "Fejl"));
    }
  }, [me]);

  useEffect(() => {
    if (!selectedOrg) return;
    void (async () => {
      try {
        const [r, reposRes] = await Promise.all([
          api<{ rosters: Roster[] }>(`/orgs/${selectedOrg}/rosters`),
          api<{ repos: Repo[] }>(`/orgs/${selectedOrg}/repos`),
        ]);
        setRosters(r.rosters);
        setRepos(reposRes.repos);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Kunne ikke hente org-data");
      }
    })();
    void loadDashboard(selectedOrg);
  }, [selectedOrg]);

  async function createOrg(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/orgs", {
        method: "POST",
        body: JSON.stringify({ name: orgName, githubOrg, token }),
      });
      setOrgName("");
      setGithubOrg("");
      setToken("");
      setInfo("GitHub-organisation tilknyttet");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke oprette org");
    }
  }

  async function importRoster(e: FormEvent) {
    e.preventDefault();
    if (!selectedOrg) return;
    setError(null);
    try {
      await api("/rosters/import", {
        method: "POST",
        body: JSON.stringify({ orgId: selectedOrg, name: rosterName, csv }),
      });
      setInfo("Roster importeret");
      const r = await api<{ rosters: Roster[] }>(`/orgs/${selectedOrg}/rosters`);
      setRosters(r.rosters);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import fejlede");
    }
  }

  async function createAssignment(e: FormEvent) {
    e.preventDefault();
    if (!selectedOrg) return;
    setError(null);
    try {
      const res = await api<{ assignment: Assignment }>("/assignments", {
        method: "POST",
        body: JSON.stringify({
          orgId: selectedOrg,
          rosterId: rosterId || null,
          title,
          slug: inviteSlug.trim() || undefined,
          templateRepo,
          mode,
          maxTeamSize: maxTeamSize ? Number(maxTeamSize) : null,
          enforceRoster: Boolean(rosterId),
        }),
      });
      setInfo(`Assignment oprettet. Del invite-linket nedenfor.`);
      setTitle("");
      setInviteSlug("");
      setSlugTouched(false);
      await load();
      const link = `${webOrigin}/a/${res.assignment.slug}`;
      await navigator.clipboard.writeText(link).catch(() => undefined);
      setCopied(res.assignment.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke oprette assignment");
    }
  }

  async function copyInvite(slug: string, id: string) {
    const link = `${webOrigin}/a/${slug}`;
    await navigator.clipboard.writeText(link);
    setCopied(id);
  }

  const filteredDashboard = dashboardRepos.filter((r) => {
    if (dashboardFilter === "active") return r.hasCommitsSinceStart;
    if (dashboardFilter === "idle") return !r.hasCommitsSinceStart && !r.error;
    return true;
  });

  return (
    <RequireTeacher me={me}>
      <Layout me={me}>
        <div className="page-head">
          <h1>Underviser</h1>
          <p>Kobl en GitHub-org, følg elev-repos, og udgiv assignments med invite-links.</p>
        </div>

        {error && <div className="error">{error}</div>}
        {info && <div className="success">{info}</div>}

        <section className="section">
          <div className="section-head">
            <div>
              <h2>Aktiv organisation</h2>
              <p>Vælg org for oversigt, roster og assignments.</p>
            </div>
            <span className="step">01</span>
          </div>
          <Field label="Organisation">
            <select value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)}>
              <option value="">Vælg organisation…</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} (@{o.githubOrg})
                </option>
              ))}
            </select>
          </Field>
        </section>

        {selectedOrg && (
          <section className="section">
            <div className="section-head">
              <div>
                <h2>Repo-oversigt</h2>
                <p>Repos oprettet via GHC — sidste commit og aktivitet siden start.</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={dashboardLoading}
                onClick={() => void loadDashboard(selectedOrg)}
              >
                {dashboardLoading ? "Henter…" : "Opdater"}
              </button>
            </div>

            {dashboardSummary && (
              <div className="dash-summary" role="group" aria-label="Repo-status">
                <button
                  type="button"
                  className={dashboardFilter === "all" ? "is-active" : undefined}
                  onClick={() => setDashboardFilter("all")}
                >
                  <strong>{dashboardSummary.total}</strong>
                  <span>repos</span>
                </button>
                <button
                  type="button"
                  className={dashboardFilter === "active" ? "is-active" : undefined}
                  onClick={() => setDashboardFilter("active")}
                >
                  <strong>{dashboardSummary.withActivity}</strong>
                  <span>med commits</span>
                </button>
                <button
                  type="button"
                  className={dashboardFilter === "idle" ? "is-active" : undefined}
                  onClick={() => setDashboardFilter("idle")}
                >
                  <strong>{dashboardSummary.idle}</strong>
                  <span>uden commits</span>
                </button>
              </div>
            )}

            {dashboardLoading && dashboardRepos.length === 0 ? (
              <p className="muted">Henter aktivitet fra GitHub…</p>
            ) : filteredDashboard.length === 0 ? (
              <p className="muted">
                {dashboardRepos.length === 0
                  ? "Ingen elev-repos endnu. Del et invite-link for at komme i gang."
                  : "Ingen repos matcher filteret."}
              </p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Repo</th>
                      <th>Assignment</th>
                      <th>Elev / gruppe</th>
                      <th>Sidste commit</th>
                      <th>Siden start</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDashboard.map((r) => (
                      <tr key={`${r.assignmentId}:${r.fullName}`}>
                        <td>
                          <a
                            href={r.htmlUrl ?? `https://github.com/${r.fullName}`}
                            target="_blank"
                            rel="noreferrer"
                            className="dash-repo"
                          >
                            <GitHubMark size={14} />
                            <span className="mono">{r.fullName.split("/")[1] ?? r.fullName}</span>
                          </a>
                          {r.error && <div className="dash-error">{r.error}</div>}
                        </td>
                        <td>
                          <div className="dash-title">{r.assignmentTitle}</div>
                          <span className={`tag tag-${r.mode}`}>
                            {r.mode === "group" ? "Gruppe" : "Individuel"}
                          </span>
                        </td>
                        <td>
                          {r.groupName ? (
                            <>
                              <div className="dash-title">{r.groupName}</div>
                              <div className="muted">{r.students.join(", ") || "—"}</div>
                            </>
                          ) : (
                            <span className="mono">@{r.students[0] ?? "—"}</span>
                          )}
                        </td>
                        <td>
                          {r.lastCommitAt ? (
                            <>
                              <div className="dash-title">{formatRelativeDa(r.lastCommitAt)}</div>
                              <div className="muted dash-msg" title={r.lastCommitMessage ?? undefined}>
                                {r.lastCommitAuthor ? `${r.lastCommitAuthor}: ` : ""}
                                {r.lastCommitMessage ?? "—"}
                              </div>
                            </>
                          ) : (
                            <span className="muted">Ingen data</span>
                          )}
                        </td>
                        <td>
                          {r.error ? (
                            <span className="tag tag-warn">Fejl</span>
                          ) : r.hasCommitsSinceStart ? (
                            <span className="tag tag-ok">
                              {r.commitsSinceStart >= 100
                                ? "100+ commits"
                                : `${r.commitsSinceStart} commit${r.commitsSinceStart === 1 ? "" : "s"}`}
                            </span>
                          ) : (
                            <span className="tag tag-idle">Ingen endnu</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <section className="section">
          <div className="section-head">
            <div>
              <h2>Tilknyt GitHub-organisation</h2>
              <p>PAT gemmes krypteret og bruges til at oprette repos og teams.</p>
            </div>
            <span className="step">02</span>
          </div>
          <form className="stack" onSubmit={(e) => void createOrg(e)}>
            <div className="grid-2">
              <Field label="Visningsnavn" hint="internt i GHC">
                <input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="GF2 Web"
                  required
                />
              </Field>
              <Field label="GitHub org" hint="login-navn" prefix={<GitHubMark size={14} />}>
                <input
                  value={githubOrg}
                  onChange={(e) => setGithubOrg(e.target.value)}
                  placeholder="Mercantech"
                  required
                />
              </Field>
            </div>
            <Field label="Organisation PAT" hint="fine-grained eller classic">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="github_pat_…"
                required
                autoComplete="off"
              />
            </Field>
            <div className="row">
              <button className="btn btn-github" type="submit">
                <GitHubMark size={16} />
                Gem organisation
              </button>
            </div>
          </form>
        </section>

        {selectedOrg && (
          <>
            <section className="section">
              <div className="section-head">
                <div>
                  <h2>Importér roster</h2>
                  <p>CSV med headers eller en simpel komma-/linje-liste.</p>
                </div>
                <span className="step">03</span>
              </div>
              <form className="stack" onSubmit={(e) => void importRoster(e)}>
                <Field label="Holdnavn">
                  <input
                    value={rosterName}
                    onChange={(e) => setRosterName(e.target.value)}
                    placeholder="Hold A — forår 2026"
                    required
                  />
                </Field>
                <Field label="CSV / kommasepareret liste" hint="email,github,name">
                  <textarea
                    value={csv}
                    onChange={(e) => setCsv(e.target.value)}
                    required
                    spellCheck={false}
                  />
                </Field>
                <button className="btn" type="submit">
                  Importér hold
                </button>
              </form>
              {rosters.length > 0 && (
                <ul className="list">
                  {rosters.map((r) => (
                    <li key={r.id}>
                      <span className="list-title">{r.name}</span>
                      <span className="muted">{r.memberCount} elever</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="section">
              <div className="section-head">
                <div>
                  <h2>Ny assignment</h2>
                  <p>Opretter offentlige repos fra et template i org’en.</p>
                </div>
                <span className="step">04</span>
              </div>
              <form className="stack" onSubmit={(e) => void createAssignment(e)}>
                <Field label="Titel">
                  <input
                    value={title}
                    onChange={(e) => {
                      const next = e.target.value;
                      setTitle(next);
                      if (!slugTouched) setInviteSlug(slugifyInvite(next));
                    }}
                    placeholder="Opgave 1 — Intro til Git"
                    required
                  />
                </Field>
                <Field
                  label="Invite-link"
                  hint="custom URL-slug"
                  prefix={<span className="invite-prefix">/a/</span>}
                >
                  <input
                    value={inviteSlug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setInviteSlug(slugifyInvite(e.target.value));
                    }}
                    placeholder="opgave-1-intro"
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    title="Kun små bogstaver, tal og bindestreger"
                    required
                    spellCheck={false}
                    autoComplete="off"
                  />
                </Field>
                {inviteSlug && (
                  <p className="invite-preview mono">
                    {webOrigin}/a/{inviteSlug}
                  </p>
                )}
                <Field
                  label="Template-repo"
                  hint="owner/repo"
                  prefix={<GitHubMark size={14} />}
                >
                  <input
                    list="repo-list"
                    value={templateRepo}
                    onChange={(e) => setTemplateRepo(e.target.value)}
                    placeholder="Mercantech/opgave-template"
                    required
                  />
                </Field>
                <datalist id="repo-list">
                  {repos.map((r) => (
                    <option key={r.fullName} value={r.fullName}>
                      {r.isTemplate ? "template" : "repo"}
                    </option>
                  ))}
                </datalist>

                <div>
                  <div className="field-label" style={{ marginBottom: "0.45rem" }}>
                    Mode
                  </div>
                  <div className="mode-toggle" role="group" aria-label="Assignment mode">
                    <button
                      type="button"
                      aria-pressed={mode === "individual"}
                      onClick={() => setMode("individual")}
                    >
                      Individuel
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === "group"}
                      onClick={() => setMode("group")}
                    >
                      Gruppe
                    </button>
                  </div>
                </div>

                <div className="grid-2">
                  <Field label="Roster" hint="valgfri">
                    <select value={rosterId} onChange={(e) => setRosterId(e.target.value)}>
                      <option value="">Åben (ingen roster)</option>
                      {rosters.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {mode === "group" && (
                    <Field label="Max team-størrelse">
                      <input
                        type="number"
                        min={2}
                        value={maxTeamSize}
                        onChange={(e) => setMaxTeamSize(e.target.value)}
                        placeholder="4"
                      />
                    </Field>
                  )}
                </div>

                <button className="btn" type="submit">
                  Udgiv assignment
                </button>
              </form>
            </section>
          </>
        )}

        <section className="section">
          <div className="section-head">
            <div>
              <h2>Assignments</h2>
              <p>Del invite-linket med eleverne.</p>
            </div>
          </div>
          {assignments.length === 0 ? (
            <p className="muted">Ingen assignments endnu.</p>
          ) : (
            <ul className="list">
              {assignments.map((a) => {
                const link = `${webOrigin}/a/${a.slug}`;
                return (
                  <li key={a.id}>
                    <div>
                      <div className="row" style={{ gap: "0.5rem", marginBottom: "0.25rem" }}>
                        <span className="list-title">{a.title}</span>
                        <span className={`tag tag-${a.mode}`}>
                          {a.mode === "group" ? "Gruppe" : "Individuel"}
                        </span>
                      </div>
                      <div className="muted mono">
                        {a.templateRepo} · {a.enrollmentCount} tilmeldt
                        {a.mode === "group" ? ` · ${a.groupCount} grupper` : ""}
                      </div>
                      <div className="invite-link">
                        <GitHubMark size={12} />
                        <code>
                          <Link to={`/a/${a.slug}`}>{link}</Link>
                        </code>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void copyInvite(a.slug, a.id)}
                    >
                      <CopyIcon />
                      {copied === a.id ? "Kopieret" : "Kopiér"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </Layout>
    </RequireTeacher>
  );
}
