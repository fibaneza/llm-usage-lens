export { auth as proxy } from "@/auth";

// Protect the dashboard and the Route Handlers, excluding the Auth.js routes
// themselves (docs/guides/auth-setup.md §6; Rule 10.3, Rule 50.4).
export const config = {
  matcher: ["/dashboard/:path*", "/api/((?!auth).*)"],
};
