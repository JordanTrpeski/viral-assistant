/** Input that fails validation; routes map it to HTTP 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** A referenced id that does not exist; routes map it to HTTP 404. */
export class NotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`Unknown ${kind} id: ${id}`);
    this.name = "NotFoundError";
  }
}
