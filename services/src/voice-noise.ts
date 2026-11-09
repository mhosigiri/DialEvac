/** Provider-supported controls for busy rooms. Agent APIs do not expose a numeric VAD amplitude threshold. */
export const NOISY_ROOM_CONFIG = {
  vad: { background_voice_detection: true },
  turn: {
    turn_eagerness: "normal",
    speculative_turn: false,
    interruption_ignore_terms: ["um", "uh", "hmm", "mm-hmm"],
  },
};
