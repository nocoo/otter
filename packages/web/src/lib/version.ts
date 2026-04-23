/**
 * Centralized app version constant.
 *
 * Injected at build time by vite.config.ts via `define` from packages/web/package.json.
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.5.1";
