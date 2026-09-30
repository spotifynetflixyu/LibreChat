import type { JobMetadataPatch } from './interfaces/IJobStore';
import type { GenerationJobMetadata } from '~/types';
import { isResolvedDelegateOcrPolicy } from '~/steel/native/delegate';
import { cloneSteelNativeHistory } from '~/steel/native/events';

export function sanitizeJobMetadata(metadata: Partial<GenerationJobMetadata>): JobMetadataPatch {
  const patch: JobMetadataPatch = {};
  if (metadata.responseMessageId) {
    patch.responseMessageId = metadata.responseMessageId;
  }
  if (metadata.isRegenerate !== undefined) {
    patch.isRegenerate = metadata.isRegenerate;
  }
  if (metadata.mcpRequestBody) {
    patch.mcpRequestBody = metadata.mcpRequestBody;
  }
  if (metadata.sender) {
    patch.sender = metadata.sender;
  }
  if (metadata.conversationId) {
    patch.conversationId = metadata.conversationId;
  }
  if (metadata.userMessage) {
    patch.userMessage = metadata.userMessage;
  }
  if (metadata.endpoint) {
    patch.endpoint = metadata.endpoint;
  }
  if (metadata.iconURL) {
    patch.iconURL = metadata.iconURL;
  }
  if (metadata.model) {
    patch.model = metadata.model;
  }
  if (metadata.agent_id) {
    patch.agent_id = metadata.agent_id;
  }
  if (metadata.isTemporary !== undefined) {
    patch.isTemporary = metadata.isTemporary;
  }
  if (metadata.retentionExpiresAt !== undefined) {
    patch.retentionExpiresAt = metadata.retentionExpiresAt;
  }
  if (metadata.agentEventDeliveryKey) {
    patch.agentEventDeliveryKey = metadata.agentEventDeliveryKey;
  }
  if (metadata.agentEventInvocationKey) {
    patch.agentEventInvocationKey = metadata.agentEventInvocationKey;
  }
  if (metadata.agentEventInvocationGenerationCreatedAt !== undefined) {
    patch.agentEventInvocationGenerationCreatedAt =
      metadata.agentEventInvocationGenerationCreatedAt;
  }
  if (metadata.agentEventDetachedActionProducerRequired !== undefined) {
    patch.agentEventDetachedActionProducerRequired =
      metadata.agentEventDetachedActionProducerRequired;
  }
  if (metadata.agentEventDetachedTerminalEvidence) {
    patch.agentEventDetachedTerminalEvidence = metadata.agentEventDetachedTerminalEvidence;
  }
  if (metadata.agentEventBindingId) {
    patch.agentEventBindingId = metadata.agentEventBindingId;
  }
  if (metadata.agentEventExpectedAction) {
    patch.agentEventExpectedAction = metadata.agentEventExpectedAction;
  }
  if (metadata.agentEventSuspension) {
    patch.agentEventSuspension = metadata.agentEventSuspension;
  }
  if (metadata.agentEventLegacyTurnToken) {
    patch.agentEventLegacyTurnToken = metadata.agentEventLegacyTurnToken;
  }
  if (metadata.scheduleId) {
    patch.scheduleId = metadata.scheduleId;
  }
  if (metadata.scheduledFor) {
    patch.scheduledFor = metadata.scheduledFor;
  }
  if (metadata.scheduleConfigRevision !== undefined) {
    patch.scheduleConfigRevision = metadata.scheduleConfigRevision;
  }
  if (metadata.scheduleManual !== undefined) {
    patch.scheduleManual = metadata.scheduleManual;
  }
  if (metadata.scheduleOutcome !== undefined) {
    patch.scheduleOutcome = metadata.scheduleOutcome;
  }
  if (metadata.scheduleOutcomeError !== undefined) {
    patch.scheduleOutcomeError = metadata.scheduleOutcomeError;
  }
  if (metadata.preserveForScheduleReconcile !== undefined) {
    patch.preserveForScheduleReconcile = metadata.preserveForScheduleReconcile;
  }
  if (metadata.promptTokens !== undefined) {
    patch.promptTokens = metadata.promptTokens;
  }
  if (metadata.preemptCapable !== undefined) {
    patch.preemptCapable = metadata.preemptCapable;
  }
  if (metadata.steerQuotesCapable !== undefined) {
    patch.steerQuotesCapable = metadata.steerQuotesCapable;
  }
  if (metadata.generationProtocolVersion === 1 || metadata.generationProtocolVersion === 2) {
    patch.generationProtocolVersion = metadata.generationProtocolVersion;
  }
  if (metadata.discoveredTools) {
    patch.discoveredTools = metadata.discoveredTools;
  }
  if (metadata.delegateOcrQuoteOnlyTurn !== undefined) {
    patch.delegateOcrQuoteOnlyTurn = metadata.delegateOcrQuoteOnlyTurn;
  }
  if (
    isResolvedDelegateOcrPolicy(metadata.delegateOcrPolicy) &&
    (metadata.delegateOcrPolicy.allowed === false ||
      metadata.delegateOcrPolicy.allowedFileKeys.length > 0)
  ) {
    patch.delegateOcrPolicy = {
      resolved: true,
      allowed: metadata.delegateOcrPolicy.allowed,
      allowedFileKeys: [
        ...new Set(metadata.delegateOcrPolicy.allowedFileKeys.map((key) => key.trim())),
      ],
    };
  }
  if (metadata.activityPhaseSnapshot) {
    patch.activityPhaseSnapshot = metadata.activityPhaseSnapshot;
  }
  if (metadata.steelHistory) {
    const history = cloneSteelNativeHistory(metadata.steelHistory);
    if (history) {
      patch.steelHistory = JSON.stringify(history);
    }
  }
  if (metadata.compactionSemanticIndex) {
    patch.compactionSemanticIndex = metadata.compactionSemanticIndex;
  }
  if (metadata.contextMeta) {
    patch.contextMeta = metadata.contextMeta;
  }
  return patch;
}
