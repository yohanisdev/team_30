import type { ApiErrorDetail, ErrorCode } from '@marketplace/contracts';

/** An error whose message is safe to show to the client. Anything else becomes a 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const validationError = (message: string, details?: ApiErrorDetail[]) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);

export const unauthenticated = (message = 'Authentication required.') =>
  new AppError(401, 'UNAUTHENTICATED', message);

export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new AppError(403, 'FORBIDDEN', message);

export const passwordChangeRequired = () =>
  new AppError(
    403,
    'PASSWORD_CHANGE_REQUIRED',
    'You must change your temporary password before continuing.',
  );

export const notFound = (resource = 'Resource') =>
  new AppError(404, 'NOT_FOUND', `${resource} not found.`);

export const conflict = (message: string, details?: ApiErrorDetail[]) =>
  new AppError(409, 'CONFLICT', message, details);

export const businessRule = (message: string, details?: ApiErrorDetail[]) =>
  new AppError(422, 'BUSINESS_RULE', message, details);

export const serviceUnavailable = (message: string) =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message);

export const assistantUnavailable = (
  message = 'The shopping assistant is unavailable right now. Please try again in a moment.',
) => new AppError(502, 'ASSISTANT_UNAVAILABLE', message);
