import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { Field, Layout, RequireAuth, type Me } from "../components";
import { GitHubMark } from "../icons";

type Group = { id: string; name: string; repo: string; memberCount: number };
type Enrollment = {
  id: string;
  status: string;
  githubRepoFullName?: string | null;
  groupId?: string | null;
  errorMessage?: string | null;
};
type AssignmentPayload = {
  assignment: {
    id: string;
    title: string;
    slug: string;
    mode: "individual" | "group";
    templateRepo: string;
    maxTeamSize?: number | null;
    org: { name: string; githubOrg: string };
    groups: Group[];
  };
  enrollment: Enrollment | null;
};

function AssignmentView({
  me,
  data,
  error,
  busy,
  groupName,
  setGroupName,
  onReload,
  setError,
  setBusy,
}: {
  me: Me | null;
  data: AssignmentPayload | null;
  error: string | null;
  busy: boolean;
  groupName: string;
  setGroupName: (v: string) => void;
  onReload: () => Promise<void>;
  setError: (v: string | null) => void;
  setBusy: (v: boolean) => void;
}) {
  async function acceptIndividual() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/assignments/${data.assignment.id}/accept`, { method: "POST" });
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Accept fejlede");
    } finally {
      setBusy(false);
    }
  }

  async function createGroup(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/assignments/${data.assignment.id}/groups`, {
        method: "POST",
        body: JSON.stringify({ name: groupName }),
      });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke oprette gruppe");
    } finally {
      setBusy(false);
    }
  }

  async function joinGroup(groupId: string) {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/assignments/${data.assignment.id}/groups/${groupId}/join`, {
        method: "POST",
      });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke joine");
    } finally {
      setBusy(false);
    }
  }

  const enrolled = data?.enrollment?.status === "active";

  return (
    <>
      {!data && !error && <p className="muted">Henter opgave…</p>}
      {error && <div className="error">{error}</div>}
      {data && (
        <>
          <section className="page-head">
            <p className="muted" style={{ marginBottom: "0.4rem" }}>
              {data.assignment.org.name}
            </p>
            <h1>{data.assignment.title}</h1>
            <p>
              <span className={`tag tag-${data.assignment.mode}`}>
                {data.assignment.mode === "group" ? "Gruppe" : "Individuel"}
              </span>{" "}
              <span className="mono" style={{ marginLeft: "0.35rem" }}>
                {data.assignment.templateRepo}
              </span>
            </p>
          </section>

          {!me?.githubLogin && (
            <div className="error">
              Du mangler et GitHub-brugernavn. <Link to="/">Sæt det på forsiden</Link> før du
              tilmelder dig.
            </div>
          )}

          {enrolled && (
            <div className="success">
              Du er tilmeldt.{" "}
              <a
                className="repo-link"
                href={`https://github.com/${data.enrollment!.githubRepoFullName}`}
                target="_blank"
                rel="noreferrer"
              >
                <GitHubMark size={14} />
                {data.enrollment!.githubRepoFullName}
              </a>
            </div>
          )}

          {data.assignment.mode === "individual" && !enrolled && me?.githubLogin && (
            <section className="section">
              <div className="section-head">
                <div>
                  <h2>Tilmeld dig</h2>
                  <p>Opretter et offentligt repo fra template og giver dig write-adgang.</p>
                </div>
                <GitHubMark size={22} />
              </div>
              <button
                className="btn btn-github"
                type="button"
                disabled={busy}
                onClick={() => void acceptIndividual()}
              >
                <GitHubMark size={16} />
                {busy ? "Opretter repo…" : "Acceptér opgave"}
              </button>
            </section>
          )}

          {data.assignment.mode === "group" && !enrolled && me?.githubLogin && (
            <>
              <section className="section">
                <div className="section-head">
                  <div>
                    <h2>Opret gruppe</h2>
                    <p>Første elev opretter Team + repo. Resten joiner bagefter.</p>
                  </div>
                  <span className="step">01</span>
                </div>
                <form className="stack" onSubmit={(e) => void createGroup(e)}>
                  <Field label="Gruppenavn" hint="bliver en del af repo-navnet">
                    <input
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="team-alpha"
                      required
                    />
                  </Field>
                  <button className="btn btn-github" type="submit" disabled={busy}>
                    <GitHubMark size={16} />
                    {busy ? "Opretter…" : "Opret gruppe + repo"}
                  </button>
                </form>
              </section>

              <section className="section">
                <div className="section-head">
                  <div>
                    <h2>Join eksisterende gruppe</h2>
                    <p>Du får adgang via GitHub Team.</p>
                  </div>
                  <span className="step">02</span>
                </div>
                {data.assignment.groups.length === 0 ? (
                  <p className="muted">Ingen grupper endnu — opret den første ovenfor.</p>
                ) : (
                  <ul className="list">
                    {data.assignment.groups.map((g) => (
                      <li key={g.id}>
                        <div>
                          <div className="list-title">{g.name}</div>
                          <div className="muted">
                            {g.memberCount} medlem{g.memberCount === 1 ? "" : "mer"}
                            {data.assignment.maxTeamSize
                              ? ` / max ${data.assignment.maxTeamSize}`
                              : ""}
                          </div>
                        </div>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={busy}
                          onClick={() => void joinGroup(g.id)}
                        >
                          Join
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}

export function InvitePage({ me }: { me: Me | null }) {
  const { token } = useParams();
  const [data, setData] = useState<AssignmentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupName, setGroupName] = useState("");

  async function load() {
    if (!token) return;
    const res = await api<AssignmentPayload>(`/assignments/by-invite/${token}`);
    setData(res);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Fejl"));
  }, [token]);

  return (
    <RequireAuth>
      <Layout me={me}>
        <AssignmentView
          me={me}
          data={data}
          error={error}
          busy={busy}
          groupName={groupName}
          setGroupName={setGroupName}
          onReload={load}
          setError={setError}
          setBusy={setBusy}
        />
      </Layout>
    </RequireAuth>
  );
}

export function SyncedSlugInvitePage({ me }: { me: Me | null }) {
  const { slug } = useParams();
  const [data, setData] = useState<AssignmentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupName, setGroupName] = useState("");

  async function load() {
    if (!slug) return;
    const res = await api<AssignmentPayload>(`/assignments/${slug}`);
    setData(res);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Fejl"));
  }, [slug]);

  return (
    <RequireAuth>
      <Layout me={me}>
        <AssignmentView
          me={me}
          data={data}
          error={error}
          busy={busy}
          groupName={groupName}
          setGroupName={setGroupName}
          onReload={load}
          setError={setError}
          setBusy={setBusy}
        />
      </Layout>
    </RequireAuth>
  );
}

export { SyncedSlugInvitePage as SlugInvitePage };
