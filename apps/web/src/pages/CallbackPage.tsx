import { useEffect, useRef, useState } from "react";
import { handleCallback } from "../auth";
import { Layout } from "../components";

export function CallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode kører effects to gange i dev — kun start én gang pr. mount-cyklus.
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const returnTo = await handleCallback(window.location.search);
        // Fuld navigation så App/useMe monteres med tokens allerede i sessionStorage.
        window.location.replace(returnTo);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Login fejlede");
      }
    })();
  }, []);

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
