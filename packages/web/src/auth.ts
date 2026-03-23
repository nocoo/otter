import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { execute } from "@/lib/cf/d1";

// Get allowed emails from environment variable
const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

// For reverse proxy environments with HTTPS, we need secure cookies
// Set USE_SECURE_COOKIES=true in .env when using HTTPS reverse proxy in development
const useSecureCookies =
  process.env.NODE_ENV === "production" ||
  process.env.NEXTAUTH_URL?.startsWith("https://") ||
  process.env.USE_SECURE_COOKIES === "true";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Trust the host header for automatic URL detection
  // This allows the app to work behind reverse proxies without manual NEXTAUTH_URL config
  trustHost: true,
  providers: [
    Google({
      // biome-ignore lint/style/noNonNullAssertion: required env vars — app won't start without them
      clientId: process.env.GOOGLE_CLIENT_ID!,
      // biome-ignore lint/style/noNonNullAssertion: required env vars — app won't start without them
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  // Cookie configuration for reverse proxy environments
  cookies: {
    pkceCodeVerifier: {
      name: useSecureCookies ? "__Secure-authjs.pkce.code_verifier" : "authjs.pkce.code_verifier",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    state: {
      name: useSecureCookies ? "__Secure-authjs.state" : "authjs.state",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    callbackUrl: {
      name: useSecureCookies ? "__Secure-authjs.callback-url" : "authjs.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    sessionToken: {
      name: useSecureCookies ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: useSecureCookies ? "__Host-authjs.csrf-token" : "authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
  callbacks: {
    async signIn({ user, profile }) {
      // Only allow specific emails
      const email = user.email?.toLowerCase();
      if (!email || !allowedEmails.includes(email)) {
        return false;
      }

      // Upsert user to D1 on every sign-in
      // Use Google's `sub` claim as the stable user ID
      const userId = profile?.sub ?? user.id;
      if (userId) {
        const now = Date.now();
        try {
          await execute(
            `INSERT INTO users (id, email, name, image, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (id) DO UPDATE SET
               email = excluded.email,
               name = excluded.name,
               image = excluded.image,
               updated_at = excluded.updated_at`,
            [userId, email, user.name ?? null, user.image ?? null, now, now],
          );
        } catch (error) {
          // Log but don't block sign-in if D1 sync fails
          console.error("[auth] Failed to sync user to D1:", error);
        }
      }

      return true;
    },
    async jwt({ token, profile }) {
      // On initial sign-in, persist Google sub as user ID in JWT
      if (profile?.sub) {
        token.userId = profile.sub;
      }
      return token;
    },
    async session({ session, token }) {
      // Expose user ID on the session object
      if (token.userId) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
});
