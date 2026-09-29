import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Field, Layout, RequireTeacher, type Me } from "../components";
import { RepoPicker } from "../components/RepoPicker";
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
  templateRepo: string;
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
  const [showSetup, setShowSetup] = useState(false);

  const [dashboardRepos, setDashboardRepos] = useState<DashboardRepo[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardFilter, setDashboardFilter] = useState<"all" | "active" | "idle">("all");
  const [templateFilter, setTemplateFilter] = useState("all");

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

  const activeOrg = orgs.find((o) => o.id === selectedOrg) ?? null;

  const templateOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of dashboardRepos) {
      if (r.templateRepo) map.set(r.templateRepo, r.templateRepo);
    }
    for (const a of assignments.filter((x) => !selectedOrg || x.org.id === selectedOrg)) {
      map.set(a.templateRepo, a.templateRepo);
    }
    return [...map.keys()].sort();
  }, [dashboardRepos, assignments, selectedOrg]);

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
    if (orgRes.orgs.length === 0) setShowSetup(true);
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
    setTemplateFilter("all");
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
      setShowSetup(false);
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
          slug: effectiveSlug || undefined,
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
      setTemplateRepo("");
      await load();
      if (selectedOrg) void loadDashboard(selectedOrg);
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

  const orgAssignments = assignments.filter((a) => !selectedOrg || a.org.id === selectedOrg);

  const filteredDashboard = dashboardRepos.filter((r) => {
    if (dashboardFilter === "active" && !r.hasCommitsSinceStart) return false;
    if (dashboardFilter === "idle" && (r.hasCommitsSinceStart || r.error)) return false;
    if (templateFilter !== "all" && r.templateRepo !== templateFilter) return false;
    return true;
  });

  const derivedSlug = slugifyInvite(title);
  const effectiveSlug = slugTouched ? inviteSlug : derivedSlug;

  return (
    <RequireTeacher me={me}>
      <Layout me={me}>
        <div className="teacher">
          <header className="teacher-hero">
            <div>
              <p className="teacher-kicker">Underviser</p>
              <h1>Classroom</h1>
              <p>Følg elev-repos, udgiv assignments og del invite-links.</p>
            </div>
            <div className="teacher-orgbar">
              <label>
                <span>Organisation</span>
                <select value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)}>
                  <option value="">Vælg organisation…</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} (@{o.githubOrg})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowSetup((v) => !v)}
              >
                {showSetup ? "Skjul setup" : "Setup"}
              </button>
            </div>
          </header>

          {error && <div className="error">{error}</div>}
          {info && <div className="success">{info}</div>}

          {showSetup && (
            <section className="teacher-panel">
              <div className="section-head">
                <div>
                  <h2>Tilknyt GitHub-organisation</h2>
                  <p>PAT gemmes krypteret og bruges til repos og teams.</p>
                </div>
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
                <button className="btn btn-github" type="submit">
                  <GitHubMark size={16} />
                  Gem organisation
                </button>
              </form>
            </section>
          )}

          {selectedOrg && activeOrg && (
            <>
              <section className="teacher-panel teacher-dash">
                <div className="section-head">
                  <div>
                    <h2>Repo-oversigt</h2>
                    <p>
                      Aktive repos i <strong>@{activeOrg.githubOrg}</strong>
                    </p>
                  </div>
                  <div className="teacher-dash-actions">
                    <label className="teacher-select">
                      <span className="sr-only">Filtrer template</span>
                      <select
                        value={templateFilter}
                        onChange={(e) => setTemplateFilter(e.target.value)}
                        aria-label="Filtrer efter template"
                      >
                        <option value="all">Alle templates</option>
                        {templateOptions.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={dashboardLoading}
                      onClick={() => void loadDashboard(selectedOrg)}
                    >
                      {dashboardLoading ? "Henter…" : "Opdater"}
                    </button>
                  </div>
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
                      ? "Ingen elev-repos endnu. Udgiv en assignment for at komme i gang."
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
                                <span className="mono">
                                  {r.fullName.split("/")[1] ?? r.fullName}
                                </span>
                              </a>
                              {r.error && <div className="dash-error">{r.error}</div>}
                            </td>
                            <td>
                              <div className="dash-title">{r.assignmentTitle}</div>
                              <div className="muted mono" style={{ fontSize: "0.78rem" }}>
                                {r.templateRepo}
                              </div>
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
                                  <div
                                    className="muted dash-msg"
                                    title={r.lastCommitMessage ?? undefined}
                                  >
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

              <div className="teacher-grid">
                <section className="teacher-panel">
                  <div className="section-head">
                    <div>
                      <h2>Ny assignment</h2>
                      <p>Offentlige repos fra template i org’en.</p>
                    </div>
                  </div>
                  <form className="stack" onSubmit={(e) => void createAssignment(e)}>
                    <Field label="Titel">
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Opgave 1 — Intro til Git"
                        required
                      />
                    </Field>
                    <Field
                      label="Invite-link"
                      hint={slugTouched ? "tilpasset" : "auto fra titel"}
                      prefix={<span className="invite-prefix">/a/</span>}
                    >
                      <input
                        value={effectiveSlug}
                        onChange={(e) => {
                          const next = slugifyInvite(e.target.value);
                          if (!next) {
                            setSlugTouched(false);
                            setInviteSlug("");
                            return;
                          }
                          setSlugTouched(true);
                          setInviteSlug(next);
                        }}
                        placeholder="opgave-1-intro"
                        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                        title="Kun små bogstaver, tal og bindestreger"
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </Field>
                    <div className="invite-slug-row">
                      {effectiveSlug ? (
                        <p className="invite-preview mono">
                          {webOrigin}/a/{effectiveSlug}
                        </p>
                      ) : (
                        <p className="invite-preview muted">Skriv en titel for at få et invite-link</p>
                      )}
                      {slugTouched && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setSlugTouched(false);
                            setInviteSlug("");
                          }}
                        >
                          Brug titel
                        </button>
                      )}
                    </div>

                    <RepoPicker
                      repos={repos}
                      value={templateRepo}
                      onChange={setTemplateRepo}
                      placeholder="Vælg template eller repo…"
                    />

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

                  <div className="teacher-divider" />

                  <div className="section-head">
                    <div>
                      <h2>Importér roster</h2>
                      <p>CSV eller kommasepareret liste.</p>
                    </div>
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
                    <button className="btn btn-ghost" type="submit">
                      Importér hold
                    </button>
                  </form>
                  {rosters.length > 0 && (
                    <ul className="teacher-chips">
                      {rosters.map((r) => (
                        <li key={r.id}>
                          {r.name}
                          <span>{r.memberCount}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="teacher-panel">
                  <div className="section-head">
                    <div>
                      <h2>Assignments</h2>
                      <p>Del invite-linket med eleverne.</p>
                    </div>
                    <span className="step">{orgAssignments.length}</span>
                  </div>
                  {orgAssignments.length === 0 ? (
                    <p className="muted">Ingen assignments endnu.</p>
                  ) : (
                    <ul className="assignment-list">
                      {orgAssignments.map((a) => {
                        const link = `${webOrigin}/a/${a.slug}`;
                        return (
                          <li key={a.id}>
                            <div className="assignment-main">
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
              </div>
            </>
          )}

          {!selectedOrg && orgs.length > 0 && (
            <p className="muted teacher-empty">Vælg en organisation øverst for at fortsætte.</p>
          )}
        </div>
      </Layout>
    </RequireTeacher>
  );
}
