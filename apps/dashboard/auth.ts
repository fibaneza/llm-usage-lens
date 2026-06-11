import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Auth.js is the identity-provider abstraction (Rule 50.3). Switching providers
// is a change to this file only — pages, proxy, and route guards use the
// Auth.js session APIs and never change. See docs/guides/auth-setup.md.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [MicrosoftEntraID],
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    // Gates the routes matched by proxy.ts.
    authorized: ({ auth }) => !!auth,
  },
});
