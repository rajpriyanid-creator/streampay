/**
 * StreamPay v2.5 Envio Event Handlers
 * Maps StreamPaySettlement contract events to indexer entities.
 */

// Placeholder handler implementations matching Envio contract event signatures
export const handleStreamOpened = async ({ event, context }: any) => {
  const sessionId = event.params.sessionId;
  context.StreamSession.set({
    id: sessionId,
    payer: event.params.payer,
    recipient: event.params.recipient,
    sessionSigner: event.params.sessionSigner,
    offerDigest: event.params.offerDigest,
    initialDeposit: event.params.initialDeposit,
    validUntil: event.params.validUntil,
    redemptionGraceSeconds: event.params.redemptionGraceSeconds,
    redemptionDeadline: event.params.redemptionDeadline,
    settledUnits: 0n,
    settledAmount: 0n,
    status: 'OPEN',
    openedAtBlock: BigInt(event.block.number),
    openedAtTimestamp: BigInt(event.block.timestamp),
  });
};

export const handleStreamCheckpointed = async ({ event, context }: any) => {
  const sessionId = event.params.sessionId;
  const current = await context.StreamSession.get(sessionId);
  if (current) {
    context.StreamSession.set({
      ...current,
      settledUnits: event.params.cumulativeUnits,
      settledAmount: event.params.totalSettled,
    });
  }

  context.Checkpoint.set({
    id: `${sessionId}-${event.transaction.hash}-${event.logIndex}`,
    session_id: sessionId,
    cumulativeUnits: event.params.cumulativeUnits,
    cumulativeAmount: event.params.cumulativeAmount,
    delta: event.params.delta,
    totalSettled: event.params.totalSettled,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: BigInt(event.block.timestamp),
  });
};

export const handleStreamClosed = async ({ event, context }: any) => {
  const sessionId = event.params.sessionId;
  const current = await context.StreamSession.get(sessionId);
  if (current) {
    const reasons = ['COOPERATIVE', 'CHALLENGE_FINALIZED', 'EXPIRED'];
    context.StreamSession.set({
      ...current,
      status: 'CLOSED',
      totalPaidOrCredited: event.params.totalPaidOrCredited,
      refundAllocated: event.params.refundAllocated,
      closeReason: reasons[event.params.closeReason] || 'UNKNOWN',
    });
  }
};
