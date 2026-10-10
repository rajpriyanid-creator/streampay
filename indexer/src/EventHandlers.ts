/**
 * StreamPay v2.5 Envio Event Handlers
 * Maps all 8+ StreamPaySettlement contract events to indexer entities.
 *
 * Checkpoint IDs are deterministic from tx hash + log index to avoid
 * double-counting on reprocessing/reorgs.
 */

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

export const handleStreamPolicyBound = async ({ event, context }: any) => {
  const sessionId = event.params.sessionId;
  const current = await context.StreamSession.get(sessionId);
  if (current) {
    context.StreamSession.set({
      ...current,
      contentIdHash: event.params.contentIdHash,
      pricingPolicyHash: event.params.pricingPolicyHash,
      manifestRoot: event.params.manifestRoot,
      unitPrice: event.params.unitPrice,
      maxBillableUnits: event.params.maxBillableUnits,
      maxLeadUnits: event.params.maxLeadUnits,
      maxCreditSegments: event.params.maxCreditSegments,
      maxCreditWindowUnits: event.params.maxCreditWindowUnits,
      maxUnredeemedAmount: event.params.maxUnredeemedAmount,
      offerExpiresAt: event.params.offerExpiresAt,
    });
  }
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

  // Deterministic checkpoint ID from tx hash + log index to be idempotent on reprocessing
  context.Checkpoint.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    session_id: sessionId,
    cumulativeUnits: event.params.cumulativeUnits,
    cumulativeAmount: event.params.cumulativeAmount,
    delta: event.params.delta,
    totalSettled: event.params.totalSettled,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: BigInt(event.block.timestamp),
  });
};

export const handleCloseRequested = async ({ event, context }: any) => {
  const sessionId = event.params.sessionId;
  const current = await context.StreamSession.get(sessionId);
  if (current) {
    context.StreamSession.set({
      ...current,
      status: 'CLOSE_REQUESTED',
      closeRequestedAt: event.params.closeRequestedAt,
      challengeEndsAt: event.params.challengeEndsAt,
    });
  }
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

export const handlePayoutCredited = async ({ event, context }: any) => {
  const key = `${event.params.token}-${event.params.account}`;
  const current = await context.ClaimableCredit.get(key);
  const prevAmount = current ? current.amount : 0n;
  context.ClaimableCredit.set({
    id: key,
    token: event.params.token,
    account: event.params.account,
    amount: prevAmount + event.params.amount,
    lastUpdated: BigInt(event.block.timestamp),
  });
};

export const handleClaimed = async ({ event, context }: any) => {
  const key = `${event.params.token}-${event.params.account}`;

  // Reset claimable balance to zero after successful claim
  context.ClaimableCredit.set({
    id: key,
    token: event.params.token,
    account: event.params.account,
    amount: 0n,
    lastUpdated: BigInt(event.block.timestamp),
  });

  // Record the claim event with deterministic ID
  context.Claim.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    token: event.params.token,
    account: event.params.account,
    amount: event.params.amount,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: BigInt(event.block.timestamp),
  });
};

export const handlePaused = async ({ event, context }: any) => {
  // Persist admin event for audit trail
  context.AdminEvent.set({
    id: `paused-${event.transaction.hash}-${event.logIndex}`,
    eventType: 'PAUSED',
    account: event.params.account,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: BigInt(event.block.timestamp),
  });
};

export const handleUnpaused = async ({ event, context }: any) => {
  // Persist admin event for audit trail
  context.AdminEvent.set({
    id: `unpaused-${event.transaction.hash}-${event.logIndex}`,
    eventType: 'UNPAUSED',
    account: event.params.account,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: BigInt(event.block.timestamp),
  });
};
