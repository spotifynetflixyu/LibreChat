/** Clears one run step's streamed text or reasoning in the turn's aggregated content and on the client. */
export type SteelStepTextReset = (stepId: string) => Promise<void>;
