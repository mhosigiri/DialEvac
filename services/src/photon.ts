// Photon Beta REST client for iMessage over a shared line. A resident is assigned to one of the
// project's pooled shared lines; the line may only reply, so the resident has to text it first
// (Photon refuses earlier sends with SHARED_LINE_INBOUND_REQUIRED).

const API = "https://api.photon.codes/v1/projects";
const REQUEST_TIMEOUT_MS = 15_000;

export class PhotonError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
  ) {
    super(`Photon ${status} ${code}: ${detail}`);
  }
}

// A text a resident sent to one of the project's lines.
export type ReceivedText = { id: string; from: string; text: string; createdAt: string };

type Fetch = typeof fetch;

export function photonClient(projectId: string, secret: string, fetchImpl: Fetch = fetch) {
  async function api<T>(method: "GET" | "POST", path: string, body?: object, idempotencyKey?: string): Promise<T> {
    const response = await fetchImpl(`${API}/${projectId}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      // One request that never answers would otherwise stall the reply poller for good.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) throw new PhotonError(response.status, String(json.code ?? "UNKNOWN"), String(json.detail ?? json.title ?? text));
    return json as T;
  }

  // Resolved once per resident: their shared line, both Photon users, and the direct space.
  const spaces = new Map<string, Promise<{ spaceId: string; senderId: string }>>();

  async function sharedLine(phone: string) {
    const { assignments } = await api<{ assignments: { handle: string; assignedPhoneNumber: string; releasedAt?: string }[] }>(
      "GET",
      "/platforms/imessage/assignments",
    );
    const active = assignments.find((a) => a.handle === phone && !a.releasedAt);
    if (active) return active.assignedPhoneNumber;
    const made = await api<{ assignedPhoneNumber: string }>("POST", "/platforms/imessage/assignments", { handle: phone }, `assign-${phone}`);
    return made.assignedPhoneNumber;
  }

  const userId = async (handle: string) => (await api<{ id: string }>("POST", "/users", { platform: "imessage", handle })).id;

  async function resolveSpace(phone: string) {
    const [agent, resident] = await Promise.all([sharedLine(phone).then(userId), userId(phone)]);
    const space = await api<{ id: string }>("POST", "/spaces", { platform: "imessage", participantIds: [agent, resident] }, `space-${agent}-${resident}`);
    return { spaceId: space.id, senderId: agent };
  }

  function spaceFor(phone: string) {
    let space = spaces.get(phone);
    if (!space) {
      space = resolveSpace(phone);
      spaces.set(phone, space);
      space.catch(() => spaces.delete(phone));
    }
    return space;
  }

  return {
    // Returns Photon's message ID. The key makes a retried send of the same queued row a no-op.
    async sendText(phone: string, text: string, idempotencyKey: string) {
      const { spaceId, senderId } = await spaceFor(phone);
      const sent = await api<{ id: string }>("POST", "/messages", { spaceId, senderId, content: { type: "text", format: "plain", text } }, idempotencyKey);
      return sent.id;
    },

    // Every text residents sent since `since` (inclusive), oldest first.
    async receivedSince(since: string) {
      const texts: ReceivedText[] = [];
      let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({ direction: "received", platform: "imessage", createdSince: since, orderBy: "created_at", order: "asc", pageSize: "200" });
        if (pageToken) query.set("pageToken", pageToken);
        const page = await api<{ items?: unknown[]; nextPageToken?: string }>("GET", `/messages?${query}`);
        texts.push(...textsFrom(page.items ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return texts;
    },
  };
}

export type PhotonClient = ReturnType<typeof photonClient>;

type RawMessage = { id?: string; createdAt?: string; sentBy?: { handle?: string; kind?: string }; content?: { type?: string; text?: string } };

// Text from people, not from our own or other agents; read receipts and typing are skipped.
export function textsFrom(messages: unknown[]): ReceivedText[] {
  return (messages as RawMessage[]).flatMap((m) =>
    m.id && m.createdAt && m.sentBy?.handle && m.sentBy.kind === "human" && m.content?.type === "text" && m.content.text
      ? [{ id: m.id, from: m.sentBy.handle, text: m.content.text, createdAt: m.createdAt }]
      : [],
  );
}
