export { auth as proxy } from "@/auth";

// Protect the dashboard and the Route Handlers, excluding the Auth.js routes
// themselves (docs/guides/auth-setup.md §6; Rule 10.3, Rule 50.4) and exactly
// /api/health, the one route served without a session (Access Control spec —
// "API routes"; Rule 10.3 exception).
export const config = {
  matcher: ["/dashboard/:path*", "/api/((?!auth(?:/|$)|health$).*)"],
};
