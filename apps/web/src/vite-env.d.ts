/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_MERCANTEC_CLIENT_ID: string;
  readonly VITE_MERCANTEC_AUTHORIZE_URL: string;
  readonly VITE_MERCANTEC_TOKEN_URL: string;
  readonly VITE_MERCANTEC_SIGNOUT_URL: string;
  readonly VITE_REDIRECT_URI: string;
  readonly VITE_WEB_ORIGIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
