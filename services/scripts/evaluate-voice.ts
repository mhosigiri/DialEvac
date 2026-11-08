import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { elevenlabs } from "../src/elevenlabs";
import { VOICE_SCENARIOS } from "../src/voice-scenarios";
import { evaluationOverride, gradeVoice, simulateVoice, type SimulationApi } from "../src/voice-evaluation";
import { VOICE_SAFETY_VERSION } from "../src/voice-safety";

const { values } = parseArgs({ options: { live: { type: "boolean", default: false }, candidate: { type: "boolean", default: false }, case: { type: "string" } } });
const scenarios = VOICE_SCENARIOS.filter(s => !values.case || s.id === values.case);
if (!scenarios.length) throw new Error("Unknown scenario ID; run eval:voice to list cases");
if (!values.live) {
  for (const scenario of scenarios) console.log(`${scenario.id} [${scenario.category}] ${scenario.criterion}`);
  console.log("Preview only. --live runs billed, synthetic text simulations plus Opus grading. --candidate tests the local safety overlay without changing the deployed agent. No phone calls or messages.");
} else {
  const agentId = process.env.VOICE_EVAL_AGENT_ID || process.env.ELEVENLABS_AGENT_ID;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!agentId || !apiKey || !process.env.ELEVENLABS_API_KEY) throw new Error("ElevenLabs agent/API key and ANTHROPIC_API_KEY are required");
  const model = process.env.VOICE_EVAL_JUDGE_MODEL || "claude-opus-5-5";
  const client = elevenlabs().conversationalAi;
  const requestOptions = { timeoutInSeconds: 20, maxRetries: 0 };
  const agent = await client.agents.get(agentId, requestOptions);
  const override = evaluationOverride(agent, values.candidate);
  const directory = new URL(`../.spacetime/voice-evals/${Date.now()}/`, import.meta.url);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const api: SimulationApi = {
    create: test => client.tests.create(test, requestOptions),
    run: (id, testId, agentConfigOverride) => client.agents.runTests(id, { tests: [{ testId }], agentConfigOverride, repeatCount: 1 }, requestOptions),
    get: id => client.tests.invocations.get(id, requestOptions),
    cancel: id => client.tests.invocations.cancel(id, requestOptions),
    remove: id => client.tests.delete(id, requestOptions),
  };
  const report = { mode: values.candidate ? "candidate-safety-overlay" : "deployed-prompt", agentId, versionId: agent.versionId, safetyVersion: VOICE_SAFETY_VERSION,
    promptHash: createHash("sha256").update(override.conversationConfig.agent!.prompt!.prompt!).digest("hex"),
    safetyPresent: override.conversationConfig.agent!.prompt!.prompt!.includes(`[${VOICE_SAFETY_VERSION}]`),
    limitations: "Synthetic text only. All mockable tools error; transfer and DTMF system tools disabled. This does not prove telephony, ASR/TTS, successful persistence or live transfer.",
    startedAt: new Date().toISOString(), results: [] as Record<string, unknown>[] };
  for (const scenario of scenarios) {
    console.log(`Running ${scenario.id} (${report.mode})`);
    try {
      const simulation = await simulateVoice(api, agentId, scenario, override);
      const grade = await gradeVoice(scenario, simulation.turns, { apiKey, model });
      report.results.push({ id: scenario.id, category: scenario.category, ...simulation, ...grade });
      console.log(`${grade.passed ? "PASS" : "FAIL"} ${scenario.id}`);
    } catch (error) {
      // Never serialize provider error objects, which may contain request credentials.
      const message = error instanceof Error && /^(Voice simulation|Opus judge|Judge returned|No agent)/.test(error.message) ? error.message : "Provider evaluation failed; inspect the test invocation in ElevenLabs";
      report.results.push({ id: scenario.id, category: scenario.category, passed: false, error: message });
      console.log(`ERROR ${scenario.id}: ${message}`);
    }
    await writeFile(new URL("report.json", directory), JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  const passed = report.results.filter(r => r.passed === true).length;
  console.log(`${passed}/${scenarios.length} passed. Report: ${fileURLToPath(new URL("report.json", directory))}`);
  if (passed !== scenarios.length || !report.safetyPresent) process.exitCode = 1;
}
