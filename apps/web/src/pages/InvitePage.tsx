import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { Layout, RequireAuth, type Me } from "../components";
import { GitHubMark } from "../icons";

type GroupMember = {
  githubLogin: string;
  name: string | null;
  htmlUrl: string;
  avatarUrl: string;
};
type Group = {
  id: string;
  name: string;
  repo: string;
  memberCount: number;
  members: GroupMember[];
};
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

function InviteShell({
  me,
  children,
}: {
  me: Me | null;
  children: ReactNode;
}) {
  return (
    <Layout me={me} landing>
      <div className="invite">
        <div className="invite-atmosphere" aria-hidden="true" />
        <div className="invite-grid" aria-hidden="true" />
        {children}
      </div>
    </Layout>
  );
}

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
  const failed = data?.enrollment?.status === "failed";
  const repoUrl = data?.enrollment?.githubRepoFullName
    ? `https://github.com/${data.enrollment.githubRepoFullName}`
    : null;

  if (!data && !error) {
    return (
      <div className="invite-stage">
        <div className="invite-loading">
          <div className="invite-pulse" />
          <p>Henter din opgave…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="invite-stage">
        <div className="invite-panel invite-panel-error">
          <p className="invite-kicker">Noget gik galt</p>
          <h1 className="invite-title">Kunne ikke åbne opgaven</h1>
          <p className="invite-lead">{error}</p>
          <Link className="btn btn-ghost" to="/">
            Til forsiden
          </Link>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const a = data.assignment;

  if (enrolled && repoUrl) {
    return (
      <div className="invite-stage invite-stage-done">
        <div className="invite-panel">
          <p className="invite-kicker invite-kicker-ok">Du er med</p>
          <h1 className="invite-title">{a.title}</h1>
          <p className="invite-lead">
            Dit repo er klar. Åbn det på GitHub og gå i gang — commits lander automatisk i
            oversigten hos din underviser.
          </p>
          <div className="invite-actions">
            <a className="btn btn-github btn-xl" href={repoUrl} target="_blank" rel="noreferrer">
              <GitHubMark size={20} />
              Åbn {data.enrollment!.githubRepoFullName}
            </a>
            <Link className="btn btn-ghost btn-xl" to="/">
              Tilbage til GHC
            </Link>
          </div>
        </div>
        <div className="invite-done-mark" aria-hidden="true">
          <span />
        </div>
      </div>
    );
  }

  if (!me?.githubLogin) {
    return (
      <div className="invite-stage">
        <div className="invite-panel">
          <p className="invite-kicker">{a.org.name}</p>
          <h1 className="invite-title">{a.title}</h1>
          <p className="invite-lead">
            Du mangler et GitHub-brugernavn, før vi kan give dig write-adgang til repoet.
          </p>
          <div className="invite-actions">
            <Link className="btn btn-xl" to="/">
              Sæt GitHub-brugernavn
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (busy) {
    return (
      <div className="invite-stage">
        <div className="invite-panel invite-panel-busy">
          <div className="invite-spinner" aria-hidden="true" />
          <p className="invite-kicker">Et øjeblik</p>
          <h1 className="invite-title">{failed ? "Genåbner dit repo" : "Opretter dit repo"}</h1>
          <p className="invite-lead">
            {failed
              ? `Vi tjekker om repoet findes og giver @${me.githubLogin} write-adgang igen.`
              : `Vi genererer repoet fra template og giver @${me.githubLogin} write-adgang.`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="invite-stage">
      <div className="invite-panel">
        <div className="invite-meta">
          <span className="invite-org">{a.org.name}</span>
          <span className={`tag tag-${a.mode}`}>
            {a.mode === "group" ? "Gruppe" : "Individuel"}
          </span>
        </div>
        <h1 className="invite-title">{a.title}</h1>
        {failed && (
          <p className="invite-lead">
            Noget gik galt sidst — prøv igen. Findes repoet allerede, genåbner vi bare din adgang.
          </p>
        )}

        {(error || (failed && data.enrollment?.errorMessage)) && (
          <div className="invite-inline-error">
            {error ?? data.enrollment?.errorMessage}
          </div>
        )}

        {a.mode === "individual" && (
          <div className="invite-actions">
            <button
              className="btn btn-github btn-xl"
              type="button"
              onClick={() => void acceptIndividual()}
            >
              <GitHubMark size={20} />
              {failed ? "Genåbn repo" : "Acceptér opgave"}
            </button>
          </div>
        )}

        {a.mode === "group" && (
          <div className="invite-group">
            {a.groups.length > 0 && (
              <>
                <div className="invite-groups-card">
                  <ul className="invite-join-list">
                    {a.groups.map((g) => {
                      const members = g.members?.length ? g.members : [];
                      const full =
                        a.maxTeamSize != null && g.memberCount >= a.maxTeamSize;
                      return (
                        <li key={g.id}>
                          <div className="invite-join-main">
                            <div className="invite-join-head">
                              <strong>{g.name}</strong>
                              {(a.maxTeamSize || g.memberCount > 0) && (
                                <span className="invite-join-meta">
                                  {g.memberCount}
                                  {a.maxTeamSize ? `/${a.maxTeamSize}` : ""}
                                </span>
                              )}
                            </div>
                            {members.length > 0 && (
                              <ul className="invite-member-list">
                                {members.map((m) => (
                                  <li key={m.githubLogin}>
                                    <a
                                      className="invite-member"
                                      href={m.htmlUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      title={
                                        m.name
                                          ? `${m.name} (@${m.githubLogin})`
                                          : `@${m.githubLogin}`
                                      }
                                    >
                                      <img
                                        className="invite-member-avatar"
                                        src={m.avatarUrl}
                                        alt=""
                                        width={28}
                                        height={28}
                                        loading="lazy"
                                      />
                                      <span className="invite-member-handle mono">
                                        @{m.githubLogin}
                                      </span>
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={busy || full}
                            onClick={() => void joinGroup(g.id)}
                          >
                            {full ? "Fuld" : "Join"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="invite-group-divider" aria-hidden="true" />
              </>
            )}

            <form className="invite-create" onSubmit={(e) => void createGroup(e)}>
              <label className="invite-field">
                <span className="sr-only">Gruppenavn</span>
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Nyt gruppenavn…"
                  required
                  autoFocus={a.groups.length === 0}
                />
              </label>
              <button
                className="btn btn-github btn-xl"
                type="submit"
                disabled={busy}
              >
                <GitHubMark size={20} />
                Opret gruppe
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function InviteRouteBody({
  me,
  load,
  deps,
}: {
  me: Me | null;
  load: () => Promise<AssignmentPayload>;
  deps: unknown[];
}) {
  const [data, setData] = useState<AssignmentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupName, setGroupName] = useState("");

  async function reload() {
    const res = await load();
    setData(res);
  }

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Fejl"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return (
    <InviteShell me={me}>
      <AssignmentView
        me={me}
        data={data}
        error={error}
        busy={busy}
        groupName={groupName}
        setGroupName={setGroupName}
        onReload={reload}
        setError={setError}
        setBusy={setBusy}
      />
    </InviteShell>
  );
}

export function InvitePage({ me }: { me: Me | null }) {
  const { token } = useParams();
  return (
    <RequireAuth>
      <InviteRouteBody
        me={me}
        deps={[token]}
        load={async () => {
          if (!token) throw new Error("Manglende invite-token");
          return api<AssignmentPayload>(`/assignments/by-invite/${token}`);
        }}
      />
    </RequireAuth>
  );
}

export function SyncedSlugInvitePage({ me }: { me: Me | null }) {
  const { slug } = useParams();
  return (
    <RequireAuth>
      <InviteRouteBody
        me={me}
        deps={[slug]}
        load={async () => {
          if (!slug) throw new Error("Manglende slug");
          return api<AssignmentPayload>(`/assignments/${slug}`);
        }}
      />
    </RequireAuth>
  );
}

export { SyncedSlugInvitePage as SlugInvitePage };
