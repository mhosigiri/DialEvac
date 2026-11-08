import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

// fsync before HTTP 200. Signed payloads are retained privately until the database commits.
export async function spoolConversation(directory: string, providerId: string, event?: unknown) {
  if (!/^conv_[A-Za-z0-9_-]{1,250}$/.test(providerId)) throw new Error("Invalid conversation id");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = createHash("sha256").update(providerId + (event ? ":webhook" : ":poll")).digest("hex") + ".json";
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(JSON.stringify({ providerId, event })); await file.sync(); } finally { await file.close(); }
  await rename(temporary, join(directory, filename));
  const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); }
}

export async function drainSpool(directory: string, ingest: (providerId: string, event?: unknown) => Promise<void>) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let failed = 0;
  for (const filename of await readdir(directory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(filename)) continue;
    const path = join(directory, filename);
    try {
      const { providerId, event } = JSON.parse(await readFile(path, "utf8")) as { providerId: string; event?: unknown };
      await ingest(providerId, event);
      await unlink(path);
    } catch { failed++; } // retain failed jobs; a poison event must not block other calls
  }
  return failed;
}
