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

const webOrigin = import.meta.env.VITE_WEB_ORIGIN ?? window.location.origin;

export function TeacherPage({ me }: { me: Me | null }) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [orgName, setOrgName] = useState("");
  const [githubOrg, setGithubOrg] = useState("");
  const [token, setToken] = useState("");

  const [rosterName, setRosterName] = useState("");
  const [csv, setCsv] = useState("email,github,name\n");

  const [title, setTitle] = useState("");
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
          templateRepo,
          mode,
          maxTeamSize: maxTeamSize ? Number(maxTeamSize) : null,
          enforceRoster: Boolean(rosterId),
        }),
      });
      setInfo(`Assignment oprettet. Del invite-linket nedenfor.`);
      setTitle("");
      await load();
      const link = `${webOrigin}/invite/${res.assignment.inviteToken}`;
      await navigator.clipboard.writeText(link).catch(() => undefined);
      setCopied(res.assignment.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke oprette assignment");
    }
  }

  async function copyInvite(token: string, id: string) {
    const link = `${webOrigin}/invite/${token}`;
    await navigator.clipboard.writeText(link);
    setCopied(id);
  }

  return (
    <RequireTeacher me={me}>
      <Layout me={me}>
        <div className="page-head">
          <h1>Underviser</h1>
          <p>Kobl en GitHub-org, importér holdet, og udgiv assignments med invite-links.</p>
        </div>

        {error && <div className="error">{error}</div>}
        {info && <div className="success">{info}</div>}

        <section className="section">
          <div className="section-head">
            <div>
              <h2>Tilknyt GitHub-organisation</h2>
              <p>PAT gemmes krypteret og bruges til at oprette repos og teams.</p>
            </div>
            <span className="step">01</span>
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

        <section className="section">
          <div className="section-head">
            <div>
              <h2>Aktiv organisation</h2>
              <p>Vælg hvilken org roster og assignments skal bruge.</p>
            </div>
            <span className="step">02</span>
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
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Opgave 1 — Intro til Git"
                    required
                  />
                </Field>
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
                const link = `${webOrigin}/invite/${a.inviteToken}`;
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
                          <Link to={`/invite/${a.inviteToken}`}>{link}</Link>
                        </code>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void copyInvite(a.inviteToken, a.id)}
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
