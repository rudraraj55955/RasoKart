/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

interface ImportMetaEnv {
  readonly VITE_E2E?: string;
  readonly VITE_HELPKART_WIDGET_URL?: string;
  readonly VITE_HELPKART_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
