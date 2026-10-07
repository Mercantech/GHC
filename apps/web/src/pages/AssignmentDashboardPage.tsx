import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { Field, Layout, RequireTeacher, type Me } from "../components";
import { InviteShare } from "../components/InviteShare";
import { GitHubMark } from "../icons";

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
    errorMessage: string | null;
    githubRepoFullName: string | null;
    acceptedAt: string;
    student: string;
    groupName: string | null;
  }>;
};

type MemberStat = {
  githubLogin: string;
  name: string | null;
  commitsSinceStart: number;
  lastCommitAt: string | null;
  htmlUrl: string;
  avatarUrl: string;
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
  members: MemberStat[];
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

function statusLabel(status: string): string {
  if (status === "active") return "Aktiv";
  if (status === "failed") return "Fejlet";
  if (status === "pending") return "Afventer";
  return status;
}

export function AssignmentDashboardPage({ me }: { me: Me | null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [repos, setRepos] = useState<DashboardRepo[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "idle">("all");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editTemplate, setEditTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);

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
      setEditTitle(detail.assignment.title);
      setEditSlug(detail.assignment.slug);
      setEditTemplate(detail.assignment.templateRepo);
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

  const commitsByLogin = useMemo(() => {
    const map = new Map<string, MemberStat>();
    for (const r of repos) {
      for (const m of r.members ?? []) {
        const key = m.githubLogin.toLowerCase();
        const prev = map.get(key);
        if (!prev || m.commitsSinceStart > prev.commitsSinceStart) {
          map.set(key, m);
        }
      }
    }
    return map;
  }, [repos]);

  async function saveAssignment(e: FormEvent) {
    e.preventDefault();
    if (!assignment) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/assignments/manage/${assignment.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editTitle.trim(),
          slug: slugifyInvite(editSlug),
          templateRepo: editTemplate.trim(),
        }),
      });
      setInfo("Assignment opdateret");
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke gemme");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAssignment() {
    if (!assignment) return;
    const ok = window.confirm(
      `Slet assignment “${assignment.title}”? Tilmeldinger slettes også (GitHub-repos beholdes).`,
    );
    if (!ok) return;
    setError(null);
    try {
      await api(`/assignments/manage/${assignment.id}`, { method: "DELETE" });
      navigate("/teacher");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke slette");
    }
  }

  async function reopenEnrollment(enrollmentId: string) {
    setReopeningId(enrollmentId);
    setError(null);
    setInfo(null);
    try {
      await api(`/enrollments/${enrollmentId}/reopen`, { method: "POST" });
      setInfo("Repo genåbnet — collaborator re-inviteret");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Genåbn fejlede");
      await load();
    } finally {
      setReopeningId(null);
    }
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
          {info && <div className="success">{info}</div>}

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
                    <span className="mono muted" title="Template">
                      {assignment.templateRepo}
                    </span>
                    <span className="muted" aria-hidden="true">
                      →
                    </span>
                    <span className="mono muted" title="Elev-repos">
                      @{assignment.org.githubOrg}
                    </span>
                  </div>
                </div>
                <div className="asg-hero-actions">
                  <div className="asg-invite-box">
                    <span>Invite-link</span>
                    <InviteShare
                      inviteUrl={inviteLink}
                      shortPath={`/a/${assignment.slug}`}
                    />
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setEditing((v) => !v);
                        setEditTitle(assignment.title);
                        setEditSlug(assignment.slug);
                        setEditTemplate(assignment.templateRepo);
                      }}
                    >
                      {editing ? "Annuller" : "Rediger"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void load()}
                    >
                      Opdater
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger-ghost btn-sm"
                      onClick={() => void deleteAssignment()}
                    >
                      Slet
                    </button>
                  </div>
                </div>
              </header>

              {editing && (
                <section className="teacher-panel">
                  <div className="section-head">
                    <div>
                      <h2>Rediger assignment</h2>
                      <p>Titel, invite-slug og template. Mode kan ikke ændres.</p>
                    </div>
                  </div>
                  <form className="stack" onSubmit={(e) => void saveAssignment(e)}>
                    <Field label="Titel">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        required
                      />
                    </Field>
                    <Field label="Invite-slug" prefix={<span className="invite-prefix">/a/</span>}>
                      <input
                        value={editSlug}
                        onChange={(e) => setEditSlug(slugifyInvite(e.target.value))}
                        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                        required
                        spellCheck={false}
                      />
                    </Field>
                    <Field label="Template-repo" hint="owner/repo — kan være fra en anden org end elev-repos">
                      <input
                        value={editTemplate}
                        onChange={(e) => setEditTemplate(e.target.value)}
                        required
                        spellCheck={false}
                        placeholder="Mercantech/mit-template"
                      />
                    </Field>
                    <p className="muted" style={{ margin: "-0.35rem 0 0", fontSize: "0.85rem" }}>
                      Elev-repos oprettes i <span className="mono">@{assignment.org.githubOrg}</span>.
                      Classroom-org PAT skal have læseadgang til template’et.
                    </p>
                    <button className="btn" type="submit" disabled={saving}>
                      {saving ? "Gemmer…" : "Gem ændringer"}
                    </button>
                  </form>
                </section>
              )}

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
                    <p>Commits pr. person siden repo-start (initial/template tælles ikke).</p>
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
                          <th>Personer</th>
                          <th>Sidste commit</th>
                          <th>I alt</th>
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
                              {r.groupName && (
                                <div className="muted" style={{ marginTop: "0.25rem" }}>
                                  {r.groupName}
                                </div>
                              )}
                              {r.error && <div className="dash-error">{r.error}</div>}
                            </td>
                            <td>
                              {r.members?.length ? (
                                <ul className="dash-member-commits">
                                  {r.members.map((m) => (
                                    <li key={m.githubLogin}>
                                      <a
                                        className="dash-member-link"
                                        href={m.htmlUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={m.name ?? `@${m.githubLogin}`}
                                      >
                                        <img
                                          className="dash-member-avatar"
                                          src={m.avatarUrl}
                                          alt=""
                                          width={28}
                                          height={28}
                                          loading="lazy"
                                        />
                                        <span className="mono">@{m.githubLogin}</span>
                                      </a>
                                      <div className="dash-member-stats">
                                        {m.commitsSinceStart > 0 ? (
                                          <span className="tag tag-ok">
                                            {m.commitsSinceStart >= 100
                                              ? "100+"
                                              : m.commitsSinceStart}{" "}
                                            commit{m.commitsSinceStart === 1 ? "" : "s"}
                                          </span>
                                        ) : (
                                          <span className="tag tag-idle">0</span>
                                        )}
                                        <span className="muted dash-member-ago">
                                          {m.lastCommitAt
                                            ? formatRelativeDa(m.lastCommitAt)
                                            : "ingen endnu"}
                                        </span>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
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
                    <p>
                      Elever der har accepteret via invite-linket. Fejlede invites kan genåbnes
                      (re-invite collaborator).
                    </p>
                  </div>
                </div>
                {assignment.enrollments.length === 0 ? (
                  <p className="muted">Ingen tilmeldinger endnu.</p>
                ) : (
                  <ul className="assignment-list">
                    {assignment.enrollments.map((e) => {
                      const member = commitsByLogin.get(e.student.toLowerCase());
                      return (
                      <li key={e.id}>
                        <div className="assignment-main">
                          <div className="row" style={{ gap: "0.5rem", marginBottom: "0.25rem" }}>
                            <div className="list-title mono">@{e.student}</div>
                            <span
                              className={`tag ${
                                e.status === "active"
                                  ? "tag-ok"
                                  : e.status === "failed"
                                    ? "tag-warn"
                                    : "tag-idle"
                              }`}
                            >
                              {statusLabel(e.status)}
                            </span>
                            {member && (
                              <span
                                className={`tag ${
                                  member.commitsSinceStart > 0 ? "tag-ok" : "tag-idle"
                                }`}
                              >
                                {member.commitsSinceStart >= 100
                                  ? "100+"
                                  : member.commitsSinceStart}{" "}
                                commit{member.commitsSinceStart === 1 ? "" : "s"}
                              </span>
                            )}
                          </div>
                          <div className="muted">
                            {e.groupName ? `${e.groupName} · ` : ""}
                            {formatRelativeDa(e.acceptedAt)}
                            {member?.lastCommitAt
                              ? ` · sidst ${formatRelativeDa(member.lastCommitAt)}`
                              : ""}
                          </div>
                          {e.errorMessage && (
                            <div className="dash-error" style={{ marginTop: "0.35rem" }}>
                              {e.errorMessage}
                            </div>
                          )}
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
                        {assignment.mode === "individual" && e.status === "failed" && (
                          <div className="my-repo-actions">
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={reopeningId === e.id}
                              onClick={() => void reopenEnrollment(e.id)}
                            >
                              {reopeningId === e.id ? "Genåbner…" : "Genåbn repo"}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                    })}
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
