export class RegScoreError extends Error {
  readonly exitCode: 2 | 1;

  constructor(message: string, exitCode: 2 | 1 = 2) {
    super(message);
    this.name = 'RegScoreError';
    this.exitCode = exitCode;
  }
}

export class ConfigError extends RegScoreError {
  readonly configPath: string;

  constructor(configPath: string, reason: string) {
    super(`config error at ${configPath}: ${reason}`);
    this.name = 'ConfigError';
    this.configPath = configPath;
  }
}

export class IntakeError extends RegScoreError {
  constructor(message: string) {
    super(message);
    this.name = 'IntakeError';
  }
}
