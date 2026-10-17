export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message = 'Bad Request', details?: unknown): ApiError {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'Unauthorized', details?: unknown): ApiError {
    return new ApiError(401, message, details);
  }

  static forbidden(message = 'Forbidden', details?: unknown): ApiError {
    return new ApiError(403, message, details);
  }

  static notFound(message = 'Resource not found', details?: unknown): ApiError {
    return new ApiError(404, message, details);
  }

  static conflict(message = 'Resource conflict', details?: unknown): ApiError {
    return new ApiError(409, message, details);
  }

  static unprocessable(message = 'Unprocessable Entity', details?: unknown): ApiError {
    return new ApiError(422, message, details);
  }

  static internal(message = 'Internal Server Error'): ApiError {
    return new ApiError(500, message);
  }
}
