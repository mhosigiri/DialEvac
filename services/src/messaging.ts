import { Spectrum, type Message } from "spectrum-ts";
import { imessage, terminal } from "spectrum-ts/providers";
import { env, mayContact } from "./env";
import type { Contract, MessageRow } from "./contract";

// The Photon service. Sends every queued outbound message over iMessage (or the local terminal
// provider) and hands every resident reply to the module, which decides what to answer.

export async function deliver(db: Contract, row: MessageRow, send: (phone: string, body: string) => Promise<string>) {
  if (row.direction !== "out") return;
  const home = db.household(row.householdId);
  if (!home) return;
  try {
    await db.claimMessage(row.id);
  } catch {
    return; // another sender claimed it
  }
  if (!mayContact(home.phone)) {
    await db.messageFailed(row.id, "number not on CONTACT_ALLOWLIST");
    return;
  }
  try {
    await db.messageSent(row.id, await send(home.phone, row.body));
  } catch (error) {
    await db.messageFailed(row.id, error instanceof Error ? error.message : String(error));
  }
}

export function replyText(message: Message) {
  return message.content.type === "text" ? message.content.text : null;
}

async function main() {
  const { connect } = await import("./db"); // generated bindings load only when the service runs
  const db = await connect();
  const app = await Spectrum({
    projectId: env.photon.projectId(),
    projectSecret: env.photon.projectSecret(),
    providers: [env.photon.provider() === "terminal" ? terminal.config() : imessage.config()],
  });

  const send = async (phone: string, body: string) => {
    if (env.photon.provider() === "terminal") {
      console.log(`[photon → ${phone}] ${body}`);
      return "terminal";
    }
    const space = await imessage(app).space.create(phone);
    const sent = await space.send(body);
    return sent?.id ?? "sent";
  };
  db.onQueuedMessage((row) => void deliver(db, row, send));

  for await (const [, message] of app.messages) {
    const text = replyText(message);
    if (text === null || !message.sender) continue;
    await db.receiveMessage(message.sender.id, text, message.id).catch((error: unknown) => console.error("[photon] reply not recorded", error));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
