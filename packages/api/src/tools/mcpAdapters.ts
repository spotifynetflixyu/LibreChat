import { normalizeServerName } from 'librechat-data-provider';
import type { UpstreamTokenProvider, UpstreamTokenProviderResolver } from '../mcp/oauth/obo';
import type { AuthIdentityContext } from '../utils/identity';
import { selectMCPUpstreamTokenProvider } from '../mcp/oauth/obo';
import { createAuthIdentityContext } from '../utils/identity';

export interface LegacyMCPAuthContextInput {
  readonly user?: Parameters<typeof createAuthIdentityContext>[0]['user'];
  readonly tenantId?: string | null;
  readonly upstreamTokenProvider?: UpstreamTokenProvider | null;
  readonly upstreamTokenProviderResolver?: UpstreamTokenProviderResolver | null;
  readonly oboIdentityContext?: AuthIdentityContext | null;
  readonly createSessionProvider: (
    identityContext: AuthIdentityContext,
  ) => UpstreamTokenProvider;
}

export interface LegacyMCPAuthContext {
  readonly upstreamTokenProvider: UpstreamTokenProvider | null | undefined;
  readonly upstreamTokenProviderResolver?: UpstreamTokenProviderResolver | null;
  readonly oboIdentityContext: AuthIdentityContext;
}

/** Builds request-bound OBO identity and selects the live credential source. */
export function resolveLegacyMCPAuthContext({
  user,
  tenantId,
  upstreamTokenProvider,
  upstreamTokenProviderResolver,
  oboIdentityContext,
  createSessionProvider,
}: LegacyMCPAuthContextInput): LegacyMCPAuthContext {
  const identityContext =
    oboIdentityContext ?? createAuthIdentityContext({ user, tenantId: tenantId ?? user?.tenantId });
  return {
    upstreamTokenProvider: selectMCPUpstreamTokenProvider({
      upstreamTokenProvider,
      upstreamTokenProviderResolver,
      createSessionProvider: () => createSessionProvider(identityContext),
    }),
    upstreamTokenProviderResolver,
    oboIdentityContext: identityContext,
  };
}

export interface MCPToolKeyServerNamesInput {
  readonly suppliedServerNames?: readonly (string | null | undefined)[];
  readonly configServerNames?: readonly (string | null | undefined)[];
}

/** Returns raw and normalized suffix candidates for legacy MCP keys. */
export function resolveMCPToolKeyServerNames({
  suppliedServerNames = [],
  configServerNames = [],
}: MCPToolKeyServerNamesInput): string[] {
  const names = [...suppliedServerNames, ...configServerNames].filter(
    (name): name is string => typeof name === 'string' && name.length > 0,
  );
  return [...new Set(names.flatMap((name) => [name, normalizeServerName(name)]))];
}
