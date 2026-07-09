import "server-only";
import pino from "pino";
import { env } from "./env";

/**
 * Structured JSON logger. Security rules (ARCHITECTURE.md §9):
 *  - redaction below is a backstop, not the strategy — never pass tokens,
 *    transaction bodies, amounts, or account numbers to the logger at all
 *  - sync runs log counts and ids only
 */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
  redact: {
    paths: [
      "access_token",
      "accessToken",
      "public_token",
      "publicToken",
      "*.access_token",
      "*.accessToken",
      "*.public_token",
      "*.publicToken",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  ...(env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});
