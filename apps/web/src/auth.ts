const CLIENT_ID = import.meta.env.VITE_MERCANTEC_CLIENT_ID ?? "ghc";
const AUTHORIZE_URL =
  import.meta.env.VITE_MERCANTEC_AUTHORIZE_URL ?? "https://auth.mercantec.tech/oauth/authorize";
const API_URL = import.meta.env.VITE_API_URL ?? "/api";
/** Token calls go via GHC API proxy (/api/oauth/token) to avoid auth-host CORS. */
const TOKEN_URL = `${API_URL}/oauth/token`;
const SIGNOUT_URL =
  import.meta.env.VITE_MERCANTEC_SIGNOUT_URL ?? "https://auth.mercantec.tech/signout";
const REDIRECT_URI =
  import.meta.env.VITE_REDIRECT_URI ?? `${window.location.origin}/auth/callback`;
const WEB_ORIGIN = import.meta.env.VITE_WEB_ORIGIN ?? window.location.origin;

const SK_VERIFIER = "ghc_pkce_verifier";
const SK_STATE = "ghc_oauth_state";
const SK_ACCESS = "ghc_access_token";
const SK_REFRESH = "ghc_refresh_token";
const SK_EXPIRES = "ghc_expires_at";
const SK_RETURN = "ghc_return_to";

function friendlyTokenError(status: number, body: string): string {
  const trimmed = body.trim();
  if (!trimmed || trimmed.startsWith("<") || /bad gateway/i.test(trimmed)) {
    if (status === 502 || status === 503 || status === 504) {
      return "API er midlertidigt utilgængelig (prøv igen om et øjeblik)";
    }
    return `Uventet svar fra serveren (HTTP ${status})`;
  }
  try {
    const json = JSON.parse(trimmed) as { error?: string; error_description?: string; message?: string };
    return json.error_description || json.message || json.error || `HTTP ${status}`;
  } catch {
    return trimmed.length > 180 ? `${trimmed.slice(0, 180)}…` : trimmed;
  }
}

type AuthListener = () => void;
const authListeners = new Set<AuthListener>();

/** Kald når tokens gemmes/ryddes, så UI kan genindlæse profil. */
export function onAuthChange(listener: AuthListener): () => void {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

function notifyAuthChange(): void {
  for (const listener of authListeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length = 64): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(hash);
}

export function getAccessToken(): string | null {
  return sessionStorage.getItem(SK_ACCESS);
}

export function clearTokens(): void {
  sessionStorage.removeItem(SK_ACCESS);
  sessionStorage.removeItem(SK_REFRESH);
  sessionStorage.removeItem(SK_EXPIRES);
  notifyAuthChange();
}

function storeTokens(data: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}): void {
  sessionStorage.setItem(SK_ACCESS, data.access_token);
  if (data.refresh_token) {
    sessionStorage.setItem(SK_REFRESH, data.refresh_token);
  }
  const expiresIn = data.expires_in ?? 900;
  sessionStorage.setItem(SK_EXPIRES, String(Date.now() + expiresIn * 1000));
  notifyAuthChange();
}

export async function beginLogin(returnTo?: string): Promise<void> {
  const verifier = randomString(64);
  const challenge = await sha256(verifier);
  const state = randomString(32);
  sessionStorage.setItem(SK_VERIFIER, verifier);
  sessionStorage.setItem(SK_STATE, state);
  if (returnTo) sessionStorage.setItem(SK_RETURN, returnTo);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

/** Undgå dobbelt token-exchange (React StrictMode / dobbelt mount). */
let callbackInflight: Promise<string> | null = null;

export async function handleCallback(search: string): Promise<string> {
  if (callbackInflight) return callbackInflight;

  callbackInflight = (async () => {
    const params = new URLSearchParams(search);
    const code = params.get("code");
    const state = params.get("state");
    const savedState = sessionStorage.getItem(SK_STATE);
    const verifier = sessionStorage.getItem(SK_VERIFIER);

    if (!code || !state || !savedState || state !== savedState || !verifier) {
      // Allerede udvekslet i denne session? Tokens findes → send videre.
      if (getAccessToken()) {
        return sessionStorage.getItem(SK_RETURN) ?? "/";
      }
      throw new Error("Ugyldig OAuth-callback (state/code)");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token-udveksling fejlede: ${friendlyTokenError(res.status, text)}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    storeTokens(data);
    sessionStorage.removeItem(SK_VERIFIER);
    sessionStorage.removeItem(SK_STATE);

    const returnTo = sessionStorage.getItem(SK_RETURN) ?? "/";
    sessionStorage.removeItem(SK_RETURN);
    return returnTo;
  })();

  try {
    return await callbackInflight;
  } finally {
    callbackInflight = null;
  }
}

async function refreshTokens(): Promise<string | null> {
  const refresh = sessionStorage.getItem(SK_REFRESH);
  if (!refresh) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: CLIENT_ID,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    clearTokens();
    return null;
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  storeTokens(data);
  return data.access_token;
}

export async function getValidAccessToken(): Promise<string | null> {
  const token = getAccessToken();
  const expiresAt = Number(sessionStorage.getItem(SK_EXPIRES) ?? 0);
  if (token && Date.now() < expiresAt - 30_000) {
    return token;
  }
  return refreshTokens();
}

export function logout(): void {
  clearTokens();
  const returnUrl = encodeURIComponent(WEB_ORIGIN + "/");
  window.location.assign(`${SIGNOUT_URL}?returnUrl=${returnUrl}`);
}

export function isLoggedIn(): boolean {
  return Boolean(getAccessToken());
}
