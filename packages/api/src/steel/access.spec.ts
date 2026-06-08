import { canAccessSteelAdmin, canAccessSteelQuote, parseSteelGuestMode } from './access';

describe('Steel access policy', () => {
  it('fails closed unless STEEL_GUEST_MODE is explicitly true', () => {
    expect(parseSteelGuestMode({})).toBe(false);
    expect(parseSteelGuestMode({ STEEL_GUEST_MODE: 'false' })).toBe(false);
    expect(parseSteelGuestMode({ STEEL_GUEST_MODE: 'TRUE' })).toBe(false);
    expect(parseSteelGuestMode({ STEEL_GUEST_MODE: 'true' })).toBe(true);
  });

  it('allows quote access for guests only when guest mode is enabled', () => {
    expect(canAccessSteelQuote({ guestMode: true, user: null, hasSteelQuoteAccess: false })).toBe(
      true,
    );
    expect(canAccessSteelQuote({ guestMode: false, user: null, hasSteelQuoteAccess: false })).toBe(
      false,
    );
  });

  it('requires logged-in Steel quote access when guest mode is disabled', () => {
    expect(
      canAccessSteelQuote({
        guestMode: false,
        user: { id: 'u_1', role: 'USER' },
        hasSteelQuoteAccess: true,
      }),
    ).toBe(true);
    expect(
      canAccessSteelQuote({
        guestMode: false,
        user: { id: 'u_1', role: 'USER' },
        hasSteelQuoteAccess: false,
      }),
    ).toBe(false);
  });

  it('uses LibreChat ADMIN role semantics for admin access and always rejects guests', () => {
    expect(canAccessSteelAdmin(null)).toBe(false);
    expect(canAccessSteelAdmin({ id: 'u_1', role: 'USER' })).toBe(false);
    expect(canAccessSteelAdmin({ id: 'u_2', role: 'ADMIN' })).toBe(true);
  });
});
