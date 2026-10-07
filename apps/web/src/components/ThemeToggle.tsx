import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "../icons";
import { resolveTheme, toggleTheme, type Theme } from "../theme";

export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof document !== "undefined" ? resolveTheme() : "light",
  );

  useEffect(() => {
    setThemeState(resolveTheme());
  }, []);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm theme-toggle"
      aria-label={theme === "dark" ? "Skift til lyst tema" : "Skift til mørkt tema"}
      title={theme === "dark" ? "Lyst tema" : "Mørkt tema"}
      onClick={() => setThemeState(toggleTheme())}
    >
      {theme === "dark" ? <SunIcon size={15} /> : <MoonIcon size={15} />}
    </button>
  );
}
