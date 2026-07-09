import "server-only";

/**
 * Typed error hierarchy (ARCHITECTURE.md §8). `publicMessage` is safe for the
 * client; internals travel on `cause` and reach logs only.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details?: unknown;

  constructor(
    public readonly publicMessage: string,
    opts?: { cause?: unknown; details?: unknown },
  ) {
    super(publicMessage, opts?.cause ? { cause: opts.cause } : undefined);
    this.name = new.target.name;
    this.details = opts?.details;
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR";
  readonly httpStatus = 400;
}

export class AuthenticationError extends AppError {
  readonly code = "UNAUTHENTICATED";
  readonly httpStatus = 401;
  constructor(message = "You must be signed in.") {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly code = "FORBIDDEN";
  readonly httpStatus = 403;
  constructor(message = "You do not have access to this resource.") {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND";
  readonly httpStatus = 404;
  constructor(message = "Not found.") {
    super(message);
  }
}

export class ConflictError extends AppError {
  readonly code = "CONFLICT";
  readonly httpStatus = 409;
}

export class RateLimitError extends AppError {
  readonly code = "RATE_LIMITED";
  readonly httpStatus = 429;
  constructor(message = "Too many requests. Try again shortly.") {
    super(message);
  }
}

export class UpstreamError extends AppError {
  readonly code = "UPSTREAM_ERROR";
  readonly httpStatus = 502;
  constructor(message = "An upstream service failed.", opts?: { cause?: unknown }) {
    super(message, opts);
  }
}

export class InternalError extends AppError {
  readonly code = "INTERNAL_ERROR";
  readonly httpStatus = 500;
  constructor(opts?: { cause?: unknown }) {
    super("Something went wrong on our end.", opts);
  }
}
