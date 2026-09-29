export type ParsedRosterRow = {
  email?: string;
  githubLogin?: string;
  displayName?: string;
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function splitLine(line: string): string[] {
  const delim = line.includes(";") && !line.includes(",") ? ";" : ",";
  return line.split(delim).map((c) => c.trim().replace(/^["']|["']$/g, ""));
}

/** Accepts CSV with headers or plain comma/newline lists of emails or github logins. */
export function parseRosterText(text: string): ParsedRosterRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length === 0) return [];

  const firstCells = splitLine(lines[0]);
  const headers = firstCells.map(normalizeHeader);
  const looksLikeHeader =
    headers.some((h) => ["email", "e-mail", "mail"].includes(h)) ||
    headers.some((h) => ["github", "github_login", "username", "login"].includes(h)) ||
    headers.some((h) => ["name", "display_name", "fulde_navn"].includes(h));

  if (looksLikeHeader) {
    const emailIdx = headers.findIndex((h) => ["email", "e-mail", "mail"].includes(h));
    const ghIdx = headers.findIndex((h) =>
      ["github", "github_login", "username", "login", "github_username"].includes(h),
    );
    const nameIdx = headers.findIndex((h) => ["name", "display_name", "fulde_navn"].includes(h));

    return lines.slice(1).map((line) => {
      const cells = splitLine(line);
      const email = emailIdx >= 0 ? cells[emailIdx] || undefined : undefined;
      const githubLogin = ghIdx >= 0 ? cells[ghIdx]?.replace(/^@/, "") || undefined : undefined;
      const displayName = nameIdx >= 0 ? cells[nameIdx] || undefined : undefined;
      return { email, githubLogin, displayName };
    }).filter((r) => r.email || r.githubLogin);
  }

  // Plain list: each line is email or github login (comma-separated on one line also OK)
  const rows: ParsedRosterRow[] = [];
  for (const line of lines) {
    for (const cell of splitLine(line)) {
      if (!cell) continue;
      if (cell.includes("@")) {
        rows.push({ email: cell.toLowerCase() });
      } else {
        rows.push({ githubLogin: cell.replace(/^@/, "") });
      }
    }
  }
  return rows;
}

export function matchesRoster(
  members: { email: string | null; githubLogin: string | null }[],
  user: { email?: string | null; githubLogin?: string | null },
): boolean {
  if (members.length === 0) return true;
  const email = user.email?.toLowerCase();
  const gh = user.githubLogin?.toLowerCase();
  return members.some((m) => {
    if (email && m.email && m.email.toLowerCase() === email) return true;
    if (gh && m.githubLogin && m.githubLogin.toLowerCase() === gh) return true;
    return false;
  });
}
