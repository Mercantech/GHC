import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { beginLogin, isLoggedIn } from "../auth";
import { Field, Layout, type Me } from "../components";
import { GitHubMark } from "../icons";

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

  useEffect(() => {
    setGithubLogin(me?.githubLogin ?? "");
  }, [me?.githubLogin]);

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
                ? "Opsæt organisation, roster og assignments — eller åbn et invite-link som elev."
                : "Åbn invite-linket fra din underviser for at tilmelde dig en opgave."}
            </p>
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
