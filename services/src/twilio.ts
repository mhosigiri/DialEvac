import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// The Twilio REST call and webhook signature check. Only the voice service imports this.

export async function placeCall(to: string, twimlUrl: string, statusUrl: string) {
  const sid = env.twilio.accountSid();
  const auth = Buffer.from(`${env.twilio.apiKeySid()}:${env.twilio.apiKeySecret()}`).toString("base64");
  const body = new URLSearchParams({
    To: to,
    From: env.twilio.fromNumber(),
    Url: twimlUrl,
    StatusCallback: statusUrl,
    StatusCallbackEvent: "completed",
  });
  body.append("StatusCallbackEvent", "answered");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Twilio answered ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { sid: string }).sid;
}

// https://www.twilio.com/docs/usage/security#validating-requests
export function validSignature(url: string, params: URLSearchParams, signature: string | undefined) {
  if (!env.twilio.validateSignature) return true;
  if (!signature) return false;
  const payload = url + [...params.keys()].sort().map((key) => key + params.get(key)).join("");
  const expected = createHmac("sha1", env.twilio.authToken()).update(payload).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function sayTwiml(line: string, language: string) {
  const voiceLanguage = language === "es" ? "es-US" : "en-US";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${voiceLanguage}">${escapeXml(line)}</Say></Response>`;
}

export function gatherTwiml(ask: string, action: string, language: string) {
  const voiceLanguage = language === "es" ? "es-US" : "en-US";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="dtmf" numDigits="1" timeout="8" action="${escapeXml(action)}"><Say language="${voiceLanguage}">${escapeXml(ask)}</Say></Gather><Say language="${voiceLanguage}">${escapeXml("We didn't get an answer. We'll try again shortly.")}</Say></Response>`;
}
