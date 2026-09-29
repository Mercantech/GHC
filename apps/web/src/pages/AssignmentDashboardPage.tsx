import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { Layout, RequireTeacher, type Me } from "../components";
import { CopyIcon, GitHubMark } from "../icons";

type AssignmentDetail = {
  id: string;
  title: string;
  slug: string;
  mode: "individual" | "group";
  templateRepo: string;
  inviteToken: string;
  maxTeamSize: number | null;
  enrollmentCount: number;
  groupCount: number;
  org: { id: string; name: string; githubOrg: string };
  createdAt: string;
  enrollments: Array<{
    id: string;
    status: string;
    githubRepoFullName: string | null;
    acceptedAt: string;
    student: string;
    groupName: string | null;
  }>;
};

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

export function AssignmentDashboardPage({ me }: { me: Me | null }) {
  const { id } = useParams();
  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [repos, setRepos] = useState<DashboardRepo[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "idle">("all");
  const [copied, setCopied] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [detail, dash] = await Promise.all([
        api<{ assignment: AssignmentDetail }>(`/assignments/manage/${id}`),
        api<{ repos: DashboardRepo[]; summary: DashboardSummary }>(
          `/dashboard/repos?assignmentId=${encodeURIComponent(id)}`,
        ),
      ]);
      setAssignment(detail.assignment);
      setRepos(dash.repos);
      setSummary(dash.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke hente assignment");
      setAssignment(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (me?.isTeacher) void load();
  }, [me, id]);

  const inviteLink = assignment ? `${webOrigin}/a/${assignment.slug}` : "";

  const filtered = useMemo(() => {
    return repos.filter((r) => {
      if (activityFilter === "active") return r.hasCommitsSinceStart;
      if (activityFilter === "idle") return !r.hasCommitsSinceStart && !r.error;
      return true;
    });
  }, [repos, activityFilter]);

  async function copyInvite() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <RequireTeacher me={me}>
      <Layout me={me}>
        <div className="teacher asg-dash">
          <div className="asg-dash-nav">
            <Link to="/teacher" className="asg-back">
              ← Tilbage til classroom
            </Link>
          </div>

          {loading && <p className="muted">Henter assignment…</p>}
          {error && <div className="error">{error}</div>}

          {assignment && !loading && (
            <>
              <header className="teacher-hero asg-hero">
                <div>
                  <p className="teacher-kicker">
                    {assignment.org.name} · @{assignment.org.githubOrg}
                  </p>
                  <h1>{assignment.title}</h1>
                  <div className="asg-hero-meta">
                    <span className={`tag tag-${assignment.mode}`}>
                      {assignment.mode === "group" ? "Gruppe" : "Individuel"}
                    </span>
                    <span className="mono muted">{assignment.templateRepo}</span>
                  </div>
                </div>
                <div className="asg-hero-actions">
                  <div className="asg-invite-box">
                    <span>Invite-link</span>
                    <code className="mono">
                      <Link to={`/a/${assignment.slug}`}>{inviteLink}</Link>
                    </code>
                  </div>
                  <div className="row">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyInvite()}>
                      <CopyIcon />
                      {copied ? "Kopieret" : "Kopiér link"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void load()}
                    >
                      Opdater
                    </button>
                  </div>
                </div>
              </header>

              {summary && (
                <div className="dash-summary asg-summary" role="group" aria-label="Status">
                  <button
                    type="button"
                    className={activityFilter === "all" ? "is-active" : undefined}
                    onClick={() => setActivityFilter("all")}
                  >
                    <strong>{summary.total}</strong>
                    <span>repos</span>
                  </button>
                  <button
                    type="button"
                    className={activityFilter === "active" ? "is-active" : undefined}
                    onClick={() => setActivityFilter("active")}
                  >
                    <strong>{summary.withActivity}</strong>
                    <span>med commits</span>
                  </button>
                  <button
                    type="button"
                    className={activityFilter === "idle" ? "is-active" : undefined}
                    onClick={() => setActivityFilter("idle")}
                  >
                    <strong>{summary.idle}</strong>
                    <span>uden commits</span>
                  </button>
                  <div className="asg-stat">
                    <strong>{assignment.enrollmentCount}</strong>
                    <span>tilmeldt</span>
                  </div>
                  {assignment.mode === "group" && (
                    <div className="asg-stat">
                      <strong>{assignment.groupCount}</strong>
                      <span>grupper</span>
                    </div>
                  )}
                </div>
              )}

              <section className="teacher-panel">
                <div className="section-head">
                  <div>
                    <h2>Aktivitet</h2>
                    <p>Repos for denne assignment — sidste commit og aktivitet siden start.</p>
                  </div>
                </div>

                {filtered.length === 0 ? (
                  <p className="muted">
                    {repos.length === 0
                      ? "Ingen har accepteret opgaven endnu."
                      : "Ingen repos matcher filteret."}
                  </p>
                ) : (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Repo</th>
                          <th>Elev / gruppe</th>
                          <th>Sidste commit</th>
                          <th>Siden start</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((r) => (
                          <tr key={r.fullName}>
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

              <section className="teacher-panel">
                <div className="section-head">
                  <div>
                    <h2>Tilmeldinger</h2>
                    <p>Elever der har accepteret via invite-linket.</p>
                  </div>
                </div>
                {assignment.enrollments.length === 0 ? (
                  <p className="muted">Ingen tilmeldinger endnu.</p>
                ) : (
                  <ul className="assignment-list">
                    {assignment.enrollments.map((e) => (
                      <li key={e.id}>
                        <div className="assignment-main">
                          <div className="list-title mono">@{e.student}</div>
                          <div className="muted">
                            {e.groupName ? `${e.groupName} · ` : ""}
                            {formatRelativeDa(e.acceptedAt)}
                          </div>
                          {e.githubRepoFullName && (
                            <a
                              className="my-repo-link"
                              href={`https://github.com/${e.githubRepoFullName}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <GitHubMark size={14} />
                              <span className="mono">{e.githubRepoFullName}</span>
                            </a>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </Layout>
    </RequireTeacher>
  );
}
