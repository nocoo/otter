import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Skip auth in E2E test environment
const SKIP_AUTH = process.env.E2E_SKIP_AUTH === "true";

// Build redirect URL respecting reverse proxy headers
function buildRedirectUrl(req: NextRequest, pathname: string): URL {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";

  if (forwardedHost) {
    // Use forwarded host from reverse proxy
    return new URL(pathname, `${forwardedProto}://${forwardedHost}`);
  }

  // Fallback to request URL
  return new URL(pathname, req.nextUrl.origin);
}

// Next.js 16 proxy convention (replaces middleware.ts)
// NextAuth's auth() returns a middleware-compatible handler
const authHandler = auth((req) => {
  // Skip auth check in E2E test environment
  if (SKIP_AUTH) {
    return NextResponse.next();
  }

  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth");
  const isWebhookRoute = req.nextUrl.pathname.startsWith("/api/webhook");

  // Allow auth routes and webhook routes (webhook uses URL-embedded token)
  if (isAuthRoute || isWebhookRoute) {
    return NextResponse.next();
  }

  // Redirect to home if logged in and trying to access login page
  if (isLoginPage && isLoggedIn) {
    return NextResponse.redirect(buildRedirectUrl(req, "/"));
  }

  // Redirect to login if not logged in and trying to access protected page
  if (!isLoginPage && !isLoggedIn) {
    return NextResponse.redirect(buildRedirectUrl(req, "/login"));
  }

  return NextResponse.next();
});

// Export as named 'proxy' function for Next.js 16
export function proxy(request: NextRequest) {
  return authHandler(request, {} as never);
}

export const config = {
  matcher: [
    // Match all paths except static files and non-auth API routes
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.ico$|.*\\.svg$|api/(?!auth)).*)",
  ],
};
