import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api } from "./api";
import { beginLogin, isLoggedIn, logout } from "./auth";
import { GitHubMark } from "./icons";

export type Me = {
  sub: string;
  name?: string | null;
  email?: string | null;
  githubLogin?: string | null;
  roles: string[];
  isTeacher: boolean;
};

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<Me>("/me");
      setMe(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke hente profil");
      setMe(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoggedIn()) {
      setLoading(false);
      return;
    }
    void reload();
  }, []);

  return { me, loading, error, reload, setMe };
}

export function Layout({
  children,
  me,
  landing = false,
}: {
  children: ReactNode;
  me?: Me | null;
  landing?: boolean;
}) {
  return (
    <div className={landing ? "shell shell-landing" : "shell"}>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <GitHubMark size={16} />
          </span>
          G<em>HC</em>
        </Link>
        <div className="row">
          {me && (
            <div className="user-chip">
              <strong>{me.name ?? me.email ?? "Bruger"}</strong>
              {me.githubLogin && (
                <span className="gh-handle">
                  <GitHubMark size={12} />@{me.githubLogin}
                </span>
              )}
            </div>
          )}
          {me ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout()}>
              Log ud
            </button>
          ) : (
            !landing && (
              <button type="button" className="btn btn-github btn-sm" onClick={() => void beginLogin()}>
                <GitHubMark size={14} />
                Log ind
              </button>
            )
          )}
        </div>
      </header>
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  prefix,
  children,
}: {
  label: string;
  hint?: string;
  prefix?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint ? <span className="field-hint">{hint}</span> : null}
      </span>
      <span className="field-control">
        {prefix ? <span className="field-prefix">{prefix}</span> : null}
        {children}
      </span>
    </label>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isLoggedIn()) {
      void beginLogin(window.location.pathname + window.location.search);
    }
  }, [navigate]);
  if (!isLoggedIn()) {
    return (
      <Layout>
        <p className="muted">Sender dig til login…</p>
      </Layout>
    );
  }
  return <>{children}</>;
}

export function RequireTeacher({ me, children }: { me: Me | null; children: ReactNode }) {
  if (!me) return null;
  if (!me.isTeacher) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
