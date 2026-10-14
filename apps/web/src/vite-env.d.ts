/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Express API gateway (browser-visible; never a secret). */
  readonly VITE_API_BASE_URL?: string;
  /** API request timeout in milliseconds. */
  readonly VITE_API_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
