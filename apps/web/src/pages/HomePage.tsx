import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { beginLogin, isLoggedIn } from "../auth";
import { Field, Layout, type Me } from "../components";
import { GitHubMark } from "../icons";

type MyRepo = {
  enrollmentId: string;
  fullName: string | null;
  htmlUrl: string | null;
  status: "pending" | "active" | "failed" | string;
  errorMessage: string | null;
  acceptedAt: string;
  assignment: {
    id: string;
    title: string;
    slug: string;
    mode: "individual" | "group";
    orgName: string;
    githubOrg: string;
  };
  groupName: string | null;
};

function formatAccepted(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("da-DK", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function statusMeta(status: string): { label: string; className: string } {
  if (status === "active") return { label: "Aktiv", className: "tag-ok" };
  if (status === "failed") return { label: "Fejlet — genåbn", className: "tag-warn" };
  if (status === "pending") return { label: "Afventer", className: "tag-idle" };
  return { label: status, className: "tag-idle" };
}

export function HomePage({
  me,
  loading,
  onGithubSaved,
}: {
  me: Me | null;
  loading: boolean;
  onGithubSaved: () => void;
}) {
  const [githubLogin, setGithubLogin] = useState(me?.githubLogin ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [repos, setRepos] = useState<MyRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);

  useEffect(() => {
    setGithubLogin(me?.githubLogin ?? me?.suggestedGithubLogin ?? "");
  }, [me?.githubLogin, me?.suggestedGithubLogin]);

  useEffect(() => {
    if (!me) {
      setRepos([]);
      return;
    }
    setReposLoading(true);
    void api<{ repos: MyRepo[] }>("/me/repos")
      .then((res) => setRepos(res.repos))
      .catch(() => setRepos([]))
      .finally(() => setReposLoading(false));
  }, [me]);

  async function saveGithub(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await api("/me/github", {
        method: "PATCH",
        body: JSON.stringify({ githubLogin }),
      });
      setMsg("GitHub-brugernavn gemt");
      onGithubSaved();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Kunne ikke gemme");
    } finally {
      setSaving(false);
    }
  }

  async function applySuggestedGithub() {
    if (!me?.suggestedGithubLogin) return;
    setGithubLogin(me.suggestedGithubLogin);
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await api("/me/github", {
        method: "PATCH",
        body: JSON.stringify({ githubLogin: me.suggestedGithubLogin }),
      });
      setMsg(`Gemt @${me.suggestedGithubLogin} fra Mercantec Auth`);
      onGithubSaved();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Kunne ikke gemme");
    } finally {
      setSaving(false);
    }
  }

  if (!isLoggedIn()) {
    return (
      <Layout landing>
        <div className="landing">
          <div className="landing-atmosphere" aria-hidden="true">
            <div className="landing-glow landing-glow-a" />
            <div className="landing-glow landing-glow-b" />
            <div className="landing-grid" />
          </div>

          <section className="landing-hero">
            <div className="landing-copy-block">
              <h1 className="landing-brand">
                G<span>HC</span>
              </h1>
              <p className="landing-headline">Opgaver direkte i jeres GitHub-org.</p>
              <p className="landing-lead">
                Template in, elev-repos out — del et invite-link, og GHC opretter repos med write-adgang.
              </p>
              <div className="landing-cta">
                <button type="button" className="btn btn-github btn-xl" onClick={() => void beginLogin()}>
                  <GitHubMark size={20} />
                  Log ind med Mercantec Auth
                </button>
              </div>
            </div>

            <div className="landing-visual" aria-hidden="true">
              <div className="landing-visual-frame">
                <div className="landing-repo landing-repo-template">
                  <span className="landing-repo-label">template</span>
                  <strong className="mono">Mercantech/intro-git</strong>
                </div>
                <div className="landing-flow-line" />
                <div className="landing-repo-stack">
                  <div className="landing-repo landing-repo-student" style={{ "--i": 0 } as CSSProperties}>
                    <span className="landing-repo-label">elev</span>
                    <strong className="mono">Mercantec-GHC/intro-anna</strong>
                  </div>
                  <div className="landing-repo landing-repo-student" style={{ "--i": 1 } as CSSProperties}>
                    <span className="landing-repo-label">elev</span>
                    <strong className="mono">Mercantec-GHC/intro-marcus</strong>
                  </div>
                  <div className="landing-repo landing-repo-student" style={{ "--i": 2 } as CSSProperties}>
                    <span className="landing-repo-label">gruppe</span>
                    <strong className="mono">Mercantec-GHC/intro-team-alpha</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </Layout>
    );
  }

  return (
    <Layout me={me}>
      {loading && <p className="muted">Henter profil…</p>}
      {me && (
        <div className="home-grid">
          <section className="page-head" style={{ gridColumn: "1 / -1", marginBottom: 0 }}>
            <h1>Hej {me.name?.split(" ")[0] ?? ""}</h1>
            <p>
              {me.isTeacher
                ? "Se dine egne opgaver, eller åbn underviser-dashboardet."
                : "Her ser du status på de opgaver, du har via GHC."}
            </p>
          </section>

          <section className="section" style={{ gridColumn: "1 / -1" }}>
            <div className="section-head">
              <div>
                <h2>Mine opgaver</h2>
                <p>Aktiv, afventer eller fejlet — genåbn via invite-linket ved fejl.</p>
              </div>
              <span className="step">{repos.length || "0"}</span>
            </div>

            {reposLoading ? (
              <p className="muted">Henter dine opgaver…</p>
            ) : repos.length === 0 ? (
              <p className="muted">
                Du har ingen opgaver endnu. Åbn et invite-link fra din underviser for at komme i
                gang.
              </p>
            ) : (
              <ul className="my-repos">
                {repos.map((r) => {
                  const st = statusMeta(r.status);
                  return (
                    <li key={r.enrollmentId}>
                      <div className="my-repo-main">
                        <div className="row" style={{ gap: "0.5rem", marginBottom: "0.3rem" }}>
                          <span className="list-title">{r.assignment.title}</span>
                          <span className={`tag tag-${r.assignment.mode}`}>
                            {r.assignment.mode === "group" ? "Gruppe" : "Individuel"}
                          </span>
                          <span className={`tag ${st.className}`}>{st.label}</span>
                        </div>
                        <div className="muted">
                          {r.assignment.orgName}
                          {r.groupName ? ` · ${r.groupName}` : ""}
                          {r.acceptedAt ? ` · ${formatAccepted(r.acceptedAt)}` : ""}
                        </div>
                        {r.errorMessage && <div className="dash-error">{r.errorMessage}</div>}
                        {r.htmlUrl && r.fullName && (
                          <a
                            className="my-repo-link"
                            href={r.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <GitHubMark size={14} />
                            <span className="mono">{r.fullName}</span>
                          </a>
                        )}
                      </div>
                      <div className="my-repo-actions">
                        {r.status === "active" && r.htmlUrl && (
                          <a
                            className="btn btn-github btn-sm"
                            href={r.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <GitHubMark size={14} />
                            Åbn
                          </a>
                        )}
                        {r.status === "failed" && (
                          <Link className="btn btn-sm" to={`/a/${r.assignment.slug}`}>
                            Genåbn
                          </Link>
                        )}
                        <Link className="btn btn-ghost btn-sm" to={`/a/${r.assignment.slug}`}>
                          Opgave
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {me.isTeacher && (
            <section className="section">
              <div className="section-head">
                <div>
                  <h2>Underviser</h2>
                  <p>Org, CSV-roster og invite-links.</p>
                </div>
              </div>
              <Link className="btn" to="/teacher">
                Åbn dashboard
              </Link>
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <div>
                <h2>GitHub-identitet</h2>
                <p>Kræves før du kan få write-adgang til assignment-repos.</p>
              </div>
              <GitHubMark size={22} />
            </div>

            {me.suggestedGithubLogin && !me.githubLogin && (
              <div className="github-suggest">
                <p>
                  Mercantec Auth foreslår{" "}
                  <strong className="mono">@{me.suggestedGithubLogin}</strong>
                  {me.loginMethod === "github" ? " (fra dit GitHub-login)" : ""}.
                </p>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={saving}
                  onClick={() => void applySuggestedGithub()}
                >
                  Brug forslag
                </button>
              </div>
            )}

            <form className="stack" onSubmit={(e) => void saveGithub(e)}>
              <Field
                label="GitHub-brugernavn"
                hint={
                  me.suggestedGithubLogin && !me.githubLogin
                    ? "fra Auth — kan ændres"
                    : "uden @"
                }
                prefix={<GitHubMark size={14} />}
              >
                <input
                  value={githubLogin}
                  onChange={(e) => setGithubLogin(e.target.value.replace(/^@/, ""))}
                  placeholder="MAGS-GH"
                  required
                  autoComplete="username"
                />
              </Field>
              <div className="row">
                <button className="btn btn-github" type="submit" disabled={saving}>
                  <GitHubMark size={16} />
                  {saving ? "Gemmer…" : "Gem GitHub-navn"}
                </button>
              </div>
              {msg && <div className="success">{msg}</div>}
              {err && <div className="error">{err}</div>}
            </form>
          </section>
        </div>
      )}
    </Layout>
  );
}
