/** Environment filenames supported by the CLI and their encrypted equivalents. */
export const ENV_FILENAMES = [".env", ".env.local"] as const;

export type EnvFilename = (typeof ENV_FILENAMES)[number];

export function secretFilename(name: EnvFilename): string {
  return `${name}.secret`;
}
