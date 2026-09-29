import { useEffect, useMemo, useRef, useState } from "react";
import { GitHubMark } from "../icons";

export type PickerRepo = {
  fullName: string;
  name: string;
  isTemplate: boolean;
};

type KindFilter = "template" | "repo" | "all";

export function RepoPicker({
  repos,
  value,
  onChange,
  placeholder = "Vælg template…",
  label = "Template-repo",
  hint = "fra org’en eller frit owner/repo",
}: {
  repos: PickerRepo[];
  value: string;
  onChange: (fullName: string) => void;
  placeholder?: string;
  label?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<KindFilter>("template");
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const templateCount = repos.filter((r) => r.isTemplate).length;
  const repoCount = repos.filter((r) => !r.isTemplate).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return repos
      .filter((r) => {
        if (kind === "template") return r.isTemplate;
        if (kind === "repo") return !r.isTemplate;
        return true;
      })
      .filter((r) => !q || r.fullName.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.isTemplate !== b.isTemplate) return a.isTemplate ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [repos, kind, query]);

  const selected = repos.find((r) => r.fullName === value);

  return (
    <div className="repo-picker" ref={rootRef}>
      <span className="field-label">
        {label}
        <span className="field-hint">{hint}</span>
      </span>

      <button
        type="button"
        className={`repo-picker-trigger${open ? " is-open" : ""}${value ? " has-value" : ""}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <GitHubMark size={16} />
        <span className="repo-picker-value">
          {value ? (
            <>
              <strong className="mono">{value}</strong>
              {selected?.isTemplate && <span className="tag tag-template">template</span>}
            </>
          ) : (
            <span className="repo-picker-placeholder">{placeholder}</span>
          )}
        </span>
        <span className="repo-picker-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="repo-picker-panel" role="listbox">
          <div className="repo-picker-toolbar">
            <label className="repo-picker-filter">
              <span className="sr-only">Filtrer type</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as KindFilter)}
                aria-label="Filtrer repos"
              >
                <option value="template">Templates ({templateCount})</option>
                <option value="repo">Repos ({repoCount})</option>
                <option value="all">Alle ({repos.length})</option>
              </select>
            </label>
            <input
              className="repo-picker-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Søg…"
              autoFocus
            />
          </div>

          <div className="repo-picker-list">
            {filtered.length === 0 ? (
              <p className="repo-picker-empty">
                {kind === "template"
                  ? "Ingen templates i org’en. Skift filter til Repos, eller skriv owner/repo manuelt."
                  : "Ingen repos matcher."}
              </p>
            ) : (
              filtered.map((r) => (
                <button
                  key={r.fullName}
                  type="button"
                  role="option"
                  aria-selected={r.fullName === value}
                  className={`repo-picker-option${r.fullName === value ? " is-selected" : ""}`}
                  onClick={() => {
                    onChange(r.fullName);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="mono">{r.name}</span>
                  <span className="repo-picker-option-meta">
                    {r.isTemplate ? (
                      <span className="tag tag-template">template</span>
                    ) : (
                      <span className="tag tag-idle">repo</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="repo-picker-manual">
            <label>
              <span>Eller skriv frit</span>
              <input
                value={value}
                onChange={(e) => onChange(e.target.value.trim())}
                placeholder="owner/repo"
                spellCheck={false}
              />
            </label>
          </div>
        </div>
      )}

      {/* Keep native required validation via hidden input synced to value */}
      <input type="text" value={value} required readOnly tabIndex={-1} className="sr-only" aria-hidden />
    </div>
  );
}
