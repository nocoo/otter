export type EnvironmentMode = "demo" | "e2e" | "prod";
export type LocalEnvironment = Readonly<{
  local: boolean;
  mode: EnvironmentMode | null;
  automated: boolean;
  locked: boolean;
  instanceId: string | null;
  csrfToken: string;
  ingestBase: string | null;
}>;

declare global {
  interface Window {
    __OTTER_LOCAL__?: boolean;
  }
}

const STORAGE_KEY = "otter:environment-mode";
const INSTANCE_ID = /^[a-zA-Z0-9_-]+$/;
let environment: LocalEnvironment | null = null;
let initialization: Promise<void> | undefined;
let switching = false;
let dirty = false;
let writes = 0;

function isMode(value: unknown): value is EnvironmentMode {
  return value === "demo" || value === "e2e" || value === "prod";
}
function descriptor(value: LocalEnvironment): LocalEnvironment {
  if (
    !value ||
    typeof value.local !== "boolean" ||
    typeof value.automated !== "boolean" ||
    typeof value.locked !== "boolean" ||
    !value.csrfToken ||
    (value.mode !== null && !isMode(value.mode)) ||
    (value.locked && (!value.automated || value.mode !== "e2e")) ||
    (value.mode !== null &&
      (!value.instanceId || !INSTANCE_ID.test(value.instanceId) || !value.ingestBase))
  )
    throw new Error("Invalid local environment descriptor");
  return Object.freeze(value);
}
async function fetchDescriptor(path: string, init?: RequestInit): Promise<LocalEnvironment> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (!response.ok) {
    const body = (await response.json()) as { error?: string };
    throw new Error(body.error ?? `Local environment unavailable (${response.status})`);
  }
  return descriptor((await response.json()) as LocalEnvironment);
}
async function accept(current: LocalEnvironment, mode: EnvironmentMode): Promise<LocalEnvironment> {
  const accepted = await fetchDescriptor("/__local/environment/select", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Otter-Local-Csrf": current.csrfToken },
    body: JSON.stringify({ mode, instanceId: current.instanceId }),
  });
  if (accepted.mode !== mode) throw new Error("Environment selection not accepted");
  return accepted;
}
function remember(accepted: LocalEnvironment): void {
  if (!accepted.local || accepted.automated) return;
  try {
    localStorage.setItem(STORAGE_KEY, accepted.mode as EnvironmentMode);
  } catch {
    /* Storage denial must not undo the accepted server selection. */
  }
}
async function initialize(): Promise<void> {
  if (window.__OTTER_LOCAL__ !== true) return;
  let current = await fetchDescriptor("/__local/environment");
  if (current.mode === null) {
    let mode: EnvironmentMode = "demo";
    if (current.local && !current.automated) {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (isMode(stored)) mode = stored;
      } catch {
        /* Default to Demo when storage is unavailable. */
      }
    }
    current = await accept(current, mode);
    remember(current);
  }
  environment = current;
}
export function initializeEnvironment(): Promise<void> {
  initialization ??= initialize();
  return initialization;
}
export function getEnvironment(): LocalEnvironment | null {
  return environment;
}
export function apiPath(path: string): string {
  if (environment) return `/__local/instances/${environment.instanceId}${path}`;
  if (window.__OTTER_LOCAL__ === true) throw new Error("Local environment not initialized");
  return path;
}
export function ingestBase(): string {
  return environment?.ingestBase ?? "https://otter.worker.hexly.ai";
}
export function setEnvironmentDraft(draft: boolean): void {
  dirty = draft;
}
export function beginEnvironmentWrite(): () => void {
  writes++;
  return () => {
    writes--;
  };
}
export async function selectEnvironment(
  mode: string,
  confirmDiscard: () => boolean | Promise<boolean>,
): Promise<boolean> {
  const current = environment;
  if (
    !current?.local ||
    current.automated ||
    current.locked ||
    switching ||
    !isMode(mode) ||
    mode === current.mode
  )
    return false;
  switching = true;
  try {
    if ((dirty || writes > 0) && !(await confirmDiscard())) return false;
    const accepted = await accept(current, mode);
    remember(accepted);
    window.location.assign("/");
    return true;
  } finally {
    switching = false;
  }
}
