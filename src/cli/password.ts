import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { EnvHideError } from "../core/errors.js";

/** Prompt for a password without echoing the entered value. */
export async function password(prompt: string): Promise<string> {
  if (!input.isTTY)
    throw new EnvHideError(
      "A TTY is required to enter a password securely.",
      2,
    );
  return new Promise((resolve, reject) => {
    const readline = createInterface({ input, output, terminal: true });
    const terminal = readline as unknown as {
      _writeToOutput?: (text: string) => void;
    };
    const originalWrite = terminal._writeToOutput;
    terminal._writeToOutput = (text) =>
      output.write(/password/i.test(text) ? text : "*");
    readline.question(prompt, (answer) => {
      terminal._writeToOutput = originalWrite;
      readline.close();
      resolve(answer);
    });
    readline.on("SIGINT", () => {
      readline.close();
      reject(new EnvHideError("Operation cancelled."));
    });
  });
}
