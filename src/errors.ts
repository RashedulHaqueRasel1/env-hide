export class EnvHideError extends Error {
  constructor(message: string, public readonly exitCode = 1) {
    super(message);
    this.name = "EnvHideError";
  }
}

/** Thrown for an invalid password or an encrypted file that cannot be trusted. */
export class DecryptionError extends EnvHideError {
  constructor() {
    super("Invalid password or corrupted secret file.");
    this.name = "DecryptionError";
  }
}
