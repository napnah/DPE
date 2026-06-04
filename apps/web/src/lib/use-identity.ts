import { useEffect, useState } from "react";
import { AUTH_CHANGED_EVENT, loadIdentity, type StoredIdentity } from "./identity";
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
    window.addEventListener(DISPLAY_NAME_CHANGED_EVENT, sync);
    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(DISPLAY_NAME_CHANGED_EVENT, sync);
      window.removeEventListener(AUTH_CHANGED_EVENT, sync);
    };
  }, []);

  return identity;
}
