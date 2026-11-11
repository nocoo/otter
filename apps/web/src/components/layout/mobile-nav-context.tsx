import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

interface MobileNavContextValue {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpenState] = useState(false);
  const setMobileOpen = useCallback((open: boolean) => {
    setMobileOpenState(open);
  }, []);
  const value = useMemo(() => ({ mobileOpen, setMobileOpen }), [mobileOpen, setMobileOpen]);
  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

// biome-ignore lint/style/useComponentExportOnlyModules: context hook is co-located with its provider
export function useMobileNav(): MobileNavContextValue {
  const context = useContext(MobileNavContext);
  if (!context) {
    throw new Error("useMobileNav must be used within MobileNavProvider");
  }
  return context;
}
