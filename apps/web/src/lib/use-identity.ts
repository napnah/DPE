import { useEffect, useState } from "react";
import { api } from "./api";
import { refreshStoredIdentityFromProfile } from "./auth-session";
import { AUTH_CHANGED_EVENT, getAuthToken, loadIdentity, type StoredIdentity } from "./identity";
import { syncLanAgentNodeId } from "./lan";

export const DISPLAY_NAME_CHANGED_EVENT = "dpe-display-name-changed";

/** Reactive identity (UID unchanged); refreshes when display name is updated in the shell. */
export function useIdentity(): StoredIdentity | null {
  const [identity, setIdentity] = useState<StoredIdentity | null>(() => loadIdentity());

  useEffect(() => {
    const sync = () => {
      const id = loadIdentity();
      setIdentity(id);
      if (id?.nodeId) void syncLanAgentNodeId(id.nodeId);
    };
    sync();
    if (getAuthToken()) {
      void api
        .me()
        .then((profile) => {
          const refreshed = refreshStoredIdentityFromProfile(profile);
          if (refreshed) {
            setIdentity(refreshed);
            if (refreshed.nodeId) void syncLanAgentNodeId(refreshed.nodeId);
          }
        })
        .catch(() => {
          /* keep cached session; route/API calls will surface expiry */
        });
    }
    window.addEventListener(DISPLAY_NAME_CHANGED_EVENT, sync);
    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(DISPLAY_NAME_CHANGED_EVENT, sync);
      window.removeEventListener(AUTH_CHANGED_EVENT, sync);
    };
  }, []);

  return identity;
}
