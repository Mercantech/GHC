import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { beginLogin, isLoggedIn } from "../auth";
import { Field, Layout, type Me } from "../components";
import { GitHubMark } from "../icons";

type MyRepo = {
  enrollmentId: string;
  fullName: string;
  htmlUrl: string;
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
    setGithubLogin(me?.githubLogin ?? "");
  }, [me?.githubLogin]);

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

  if (!isLoggedIn()) {
    return (
      <Layout landing>
        <div className="landing">
          <div className="landing-visual" aria-hidden="true" />
          <section className="landing-hero">
            <h1 className="landing-brand">
              G<span>HC</span>
            </h1>
            <p className="landing-copy">
              Opret GitHub-opgaver fra templates, del et invite-link, og saml elever i repos —
              individuelt eller i grupper.
            </p>
            <div className="landing-cta">
              <button type="button" className="btn btn-github" onClick={() => void beginLogin()}>
                <GitHubMark size={18} />
                Log ind med Mercantec Auth
              </button>
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
                ? "Se dine egne repos, eller åbn underviser-dashboardet."
                : "Her ser du de repos, du har fået via GHC."}
            </p>
          </section>

          <section className="section" style={{ gridColumn: "1 / -1" }}>
            <div className="section-head">
              <div>
                <h2>Mine repos</h2>
                <p>Opgaver du har accepteret gennem systemet.</p>
              </div>
              <span className="step">{repos.length || "0"}</span>
            </div>

            {reposLoading ? (
              <p className="muted">Henter dine repos…</p>
            ) : repos.length === 0 ? (
              <p className="muted">
                Du har ingen repos endnu. Åbn et invite-link fra din underviser for at komme i
                gang.
              </p>
            ) : (
              <ul className="my-repos">
                {repos.map((r) => (
                  <li key={r.enrollmentId}>
                    <div className="my-repo-main">
                      <div className="row" style={{ gap: "0.5rem", marginBottom: "0.3rem" }}>
                        <span className="list-title">{r.assignment.title}</span>
                        <span className={`tag tag-${r.assignment.mode}`}>
                          {r.assignment.mode === "group" ? "Gruppe" : "Individuel"}
                        </span>
                      </div>
                      <div className="muted">
                        {r.assignment.orgName}
                        {r.groupName ? ` · ${r.groupName}` : ""}
                        {r.acceptedAt ? ` · ${formatAccepted(r.acceptedAt)}` : ""}
                      </div>
                      <a
                        className="my-repo-link"
                        href={r.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <GitHubMark size={14} />
                        <span className="mono">{r.fullName}</span>
                      </a>
                    </div>
                    <div className="my-repo-actions">
                      <a
                        className="btn btn-github btn-sm"
                        href={r.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <GitHubMark size={14} />
                        Åbn
                      </a>
                      <Link className="btn btn-ghost btn-sm" to={`/a/${r.assignment.slug}`}>
                        Opgave
                      </Link>
                    </div>
                  </li>
                ))}
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
            <form className="stack" onSubmit={(e) => void saveGithub(e)}>
              <Field
                label="GitHub-brugernavn"
                hint="uden @"
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
