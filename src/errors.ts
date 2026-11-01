export type ErrorCode = 'validation' | 'authentication' | 'authorization' | 'network' | 'rate-limit' | 'capability' | 'model' | 'synthesis' | 'rendering';
export class AppError extends Error {
  readonly error: { code: ErrorCode; message: string; details?: string };
  readonly retryAfterMs?: number;
  constructor(code: ErrorCode, message: string, details?: string, retryAfterMs?: number) {
    super(message);
    this.error = { code, message, ...(details ? { details } : {}) };
    this.retryAfterMs = retryAfterMs;
  }
}
export function publicError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Canceled locally; remote jobs may continue and incur charges.';
  if (error instanceof AppError) return error.error.message;
  if (error instanceof Error && error.name === 'ZodError') return 'Returned data failed validation. Review the service output or input format.';
  return error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[redacted URL]').replace(/(api-key|subscription-key|authorization)\s*[:=]\s*\S+/gi, '$1: [redacted]') : 'Operation failed. Review settings and retry deliberately.';
}
