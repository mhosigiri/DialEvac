// Transcript rows reference calls, and calls reference households. Follow both keys before display.
export function transcriptsForHousehold<T extends { callId: bigint }>(
  transcripts: readonly T[],
  calls: readonly { id: bigint; householdId: bigint }[],
  householdId: bigint | undefined,
) {
  if (householdId === undefined) return [];
  const callIds = new Set(calls.filter(call => call.householdId === householdId).map(call => call.id));
  return transcripts.filter(line => callIds.has(line.callId));
}
