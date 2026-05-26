export interface SteelAccessUser {
  id: string;
  role?: string | null;
}

export interface SteelGuestModeEnv {
  [key: string]: string | undefined;
  STEEL_GUEST_MODE?: string;
}

export interface SteelQuoteAccessInput {
  guestMode: boolean;
  user: SteelAccessUser | null;
  hasSteelQuoteAccess: boolean;
}

export function parseSteelGuestMode(env: SteelGuestModeEnv = process.env): boolean {
  return env.STEEL_GUEST_MODE === 'true';
}

export function canAccessSteelAdmin(user: SteelAccessUser | null): boolean {
  return user?.role === 'ADMIN';
}

export function canAccessSteelQuote({
  guestMode,
  user,
  hasSteelQuoteAccess,
}: SteelQuoteAccessInput): boolean {
  if (guestMode) {
    return true;
  }

  return Boolean(user?.id && hasSteelQuoteAccess);
}
