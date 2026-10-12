import { scopeConversationDeletion } from './deletion';

it('preserves recovery identity while overriding a supplied tenant with the authenticated tenant', () => {
  expect(scopeConversationDeletion({ conversationId: 'conversation', tenantId: 'foreign' }, 'owner'))
    .toEqual({ conversationId: 'conversation', tenantId: 'owner' });
  expect(scopeConversationDeletion({ conversationId: { $in: ['conversation'] } }))
    .toEqual({ conversationId: { $in: ['conversation'] }, tenantId: null });
  expect(scopeConversationDeletion({}, 'owner')).toEqual({ tenantId: 'owner' });
});
