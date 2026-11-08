import { readFileSync, writeFileSync } from "node:fs";

const ENV_PATH = new URL("../../.env", import.meta.url);

export function saveToEnvFile(values: Record<string, string>) {
  let text = readFileSync(ENV_PATH, "utf8");
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
    const line = `${key}=${value}`;
    const existing = new RegExp(`^${key}=.*$`, "m");
    text = existing.test(text) ? text.replace(existing, () => line) : `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(ENV_PATH, text);
}
