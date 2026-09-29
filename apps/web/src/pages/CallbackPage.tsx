import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { handleCallback } from "../auth";
import { Layout } from "../components";

export function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const returnTo = await handleCallback(window.location.search);
        navigate(returnTo, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Login fejlede");
      }
    })();
  }, [navigate]);

  return (
    <Layout>
      {error ? (
        <div className="error">{error}</div>
      ) : (
        <section className="page-head">
          <h1>Logger ind…</h1>
          <p>Henter tokens og sender dig videre.</p>
        </section>
      )}
    </Layout>
  );
}
