export type SessionRoute = {
  sessionId: string | null;
  normalizedPath: string;
  valid: boolean;
};

function trimTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function buildSessionPath(sessionId?: string | null): string {
  const normalized = sessionId?.trim();
  if (!normalized) return "/chat";
  return `/chat/${encodeURIComponent(normalized)}`;
}

export function parseSessionRoute(pathname: string): SessionRoute {
  const cleanPath = trimTrailingSlash(pathname || "/");
  if (cleanPath === "/" || cleanPath === "/index.html" || cleanPath === "/chat") {
    return {
      sessionId: null,
      normalizedPath: buildSessionPath(null),
      valid: true,
    };
  }

  if (cleanPath.startsWith("/chat/")) {
    const suffix = cleanPath.slice("/chat/".length);
    if (!suffix || suffix.includes("/")) {
      return {
        sessionId: null,
        normalizedPath: buildSessionPath(null),
        valid: false,
      };
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(suffix);
    } catch {
      return {
        sessionId: null,
        normalizedPath: buildSessionPath(null),
        valid: false,
      };
    }
    return {
      sessionId: decoded,
      normalizedPath: buildSessionPath(decoded),
      valid: true,
    };
  }

  return {
    sessionId: null,
    normalizedPath: buildSessionPath(null),
    valid: false,
  };
}

export function pushSessionPath(sessionId?: string | null): void {
  window.history.pushState({}, "", buildSessionPath(sessionId));
}

export function replaceSessionPath(sessionId?: string | null): void {
  window.history.replaceState({}, "", buildSessionPath(sessionId));
}
