import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Security headers (M8, ARCHITECTURE.md §10). CSP notes:
 * - script-src needs 'unsafe-inline' for Next's bootstrap inline scripts
 *   (nonce-based CSP is a deliberate non-goal for v1) and cdn.plaid.com for
 *   Plaid Link; dev additionally needs 'unsafe-eval' for HMR.
 * - style-src 'unsafe-inline': React style attributes (chart bar widths).
 * - frame-src cdn.plaid.com: the Link iframe. frame-ancestors 'none': this app
 *   must never be embeddable (clickjacking).
 * - connect-src includes Plaid's API hosts used by the Link client.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://cdn.plaid.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.plaid.com",
  "font-src 'self'",
  "connect-src 'self' https://cdn.plaid.com https://sandbox.plaid.com https://production.plaid.com",
  "frame-src https://cdn.plaid.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // no-op over http (dev); instructs browsers to pin https in production
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
