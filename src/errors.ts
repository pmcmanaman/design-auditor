// Exit codes are part of the CLI contract for CI pipelines
export const EXIT_CODES = {
  ok: 0,
  fatal: 1,
  auth: 2,
  navigation: 3,
  threshold: 4,
} as const;

export class AuditorError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthError extends AuditorError {
  constructor(message: string) {
    super(message, EXIT_CODES.auth);
  }
}

export class NavigationError extends AuditorError {
  constructor(message: string) {
    super(message, EXIT_CODES.navigation);
  }
}

export class ConfigError extends AuditorError {
  constructor(message: string) {
    super(message, EXIT_CODES.fatal);
  }
}
