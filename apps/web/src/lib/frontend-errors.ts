export type FrontendErrorEntry = {
  id: number;
  at: string;
  message: string;
  route: string;
  source: string;
};

const ERROR_EVENT = "dpe-frontend-error";
const ERROR_PREFIX = "[DPE_FRONTEND_ERROR]";
const MAX_ERRORS = 100;

let nextErrorId = 1;
let installed = false;
const lastMessages = new WeakMap<Element, string>();

function currentRoute(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function makeEntry(message: string, source: string): FrontendErrorEntry {
  return {
    id: nextErrorId++,
    at: new Date().toISOString(),
    message,
    route: currentRoute(),
    source,
  };
}

export function reportFrontendError(message: string, source = "manual"): FrontendErrorEntry | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  const entry = makeEntry(trimmed, source);
  window.__DPE_FRONTEND_ERRORS__ = [...(window.__DPE_FRONTEND_ERRORS__ ?? []), entry].slice(-MAX_ERRORS);
  window.__DPE_LAST_FRONTEND_ERROR__ = entry;
  console.error(ERROR_PREFIX, entry);
  window.dispatchEvent(new CustomEvent<FrontendErrorEntry>(ERROR_EVENT, { detail: entry }));
  return entry;
}

function reportVisibleError(element: Element) {
  const message = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (!message) return;
  if (lastMessages.get(element) === message) return;

  lastMessages.set(element, message);
  element.setAttribute("data-dpe-error", "true");
  if (!element.getAttribute("role")) element.setAttribute("role", "alert");
  reportFrontendError(message, "visible-app-error");
}

function scanVisibleErrors(root: ParentNode = document) {
  for (const element of root.querySelectorAll(".app-error")) {
    reportVisibleError(element);
  }
}

export function installFrontendErrorObserver() {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;

  window.dpeFrontendErrors = {
    get: () => window.__DPE_FRONTEND_ERRORS__ ?? [],
    clear: () => {
      window.__DPE_FRONTEND_ERRORS__ = [];
      window.__DPE_LAST_FRONTEND_ERROR__ = undefined;
    },
  };

  scanVisibleErrors();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.target instanceof Element && mutation.target.matches(".app-error")) {
        reportVisibleError(mutation.target);
      }
      if (mutation.target instanceof Text && mutation.target.parentElement?.matches(".app-error")) {
        reportVisibleError(mutation.target.parentElement);
      }
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(".app-error")) reportVisibleError(node);
        scanVisibleErrors(node);
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

declare global {
  interface Window {
    __DPE_FRONTEND_ERRORS__?: FrontendErrorEntry[];
    __DPE_LAST_FRONTEND_ERROR__?: FrontendErrorEntry;
    dpeFrontendErrors?: {
      get: () => FrontendErrorEntry[];
      clear: () => void;
    };
  }
}
