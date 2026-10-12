/** Apply the authenticated tenant to conversation and message deletion filters. */
export function scopeConversationDeletion<T extends Record<string, unknown>>(
  filter: T,
  tenantId?: string,
): T & { tenantId: string | null } {
  return { ...filter, tenantId: tenantId ?? null };
}
