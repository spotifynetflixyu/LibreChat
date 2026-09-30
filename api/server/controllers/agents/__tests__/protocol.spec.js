const {
  GENERATION_PROTOCOL_V1,
  GENERATION_PROTOCOL_V2,
  sanitizeDurableErrorMessage,
  getRequestedGenerationProtocol,
  getServerGenerationProtocol,
  negotiateNewGenerationProtocol,
  negotiateExistingGenerationProtocol,
} = require('../protocol');

describe('generation protocol negotiation', () => {
  test('missing, invalid, or conflicting advertisements fail closed to v1', () => {
    expect(getRequestedGenerationProtocol({})).toBe(GENERATION_PROTOCOL_V1);
    expect(
      getRequestedGenerationProtocol({
        body: { generationProtocolVersion: 2 },
        headers: { 'x-librechat-generation-protocol': 'bogus' },
      }),
    ).toBe(GENERATION_PROTOCOL_V1);
    expect(
      getRequestedGenerationProtocol({
        body: { generationProtocolVersion: 2 },
        headers: { 'x-librechat-generation-protocol': '1' },
      }),
    ).toBe(GENERATION_PROTOCOL_V1);
  });

  test('accepts a consistent v2 advertisement across body, query, and header', () => {
    expect(
      getRequestedGenerationProtocol({
        body: { generationProtocolVersion: 2 },
        query: { generationProtocolVersion: '2' },
        headers: { 'x-librechat-generation-protocol': '2' },
      }),
    ).toBe(GENERATION_PROTOCOL_V2);
  });

  test('advertises protocol v2 for every built-in generation store', () => {
    expect(getServerGenerationProtocol()).toBe(GENERATION_PROTOCOL_V2);
  });

  test('selects the protocol advertised by a new-generation client', () => {
    const current = {
      body: { generationProtocolVersion: 2 },
      headers: { 'x-librechat-generation-protocol': '2' },
    };
    expect(negotiateNewGenerationProtocol(current)).toBe(GENERATION_PROTOCOL_V2);
    expect(negotiateNewGenerationProtocol({})).toBe(GENERATION_PROTOCOL_V1);
  });

  test('never upgrades a live v1 job after new generations move to v2', () => {
    const req = {
      query: { generationProtocolVersion: '2' },
      headers: { 'x-librechat-generation-protocol': '2' },
    };
    expect(
      negotiateExistingGenerationProtocol(req, {
        metadata: { generationProtocolVersion: 1 },
      }),
    ).toBe(GENERATION_PROTOCOL_V1);
    expect(
      negotiateExistingGenerationProtocol(req, {
        metadata: { generationProtocolVersion: 2 },
      }),
    ).toBe(GENERATION_PROTOCOL_V2);
    expect(negotiateExistingGenerationProtocol(req, { metadata: {} })).toBe(GENERATION_PROTOCOL_V1);
  });
});

describe('durable error message sanitization', () => {
  test('uses fallback for missing or control-only messages', () => {
    expect(sanitizeDurableErrorMessage(null, 'Generation failed')).toBe('Generation failed');
    expect(sanitizeDurableErrorMessage({ message: '\u0000\u001b' }, 'Resume failed')).toBe(
      'Resume failed',
    );
  });

  test('redacts URLs, bearer credentials, secrets, and control whitespace', () => {
    expect(
      sanitizeDurableErrorMessage(
        {
          message:
            'request failed https://example.com/path Bearer bearer-token token=secret;\u0000next',
        },
        'Generation failed',
      ),
    ).toBe('request failed [redacted-url] Bearer [redacted] token=[redacted]; next');
  });

  test('truncates output to 512 characters', () => {
    const result = sanitizeDurableErrorMessage({ message: 'a'.repeat(600) }, 'Generation failed');
    expect(result).toBe(`${'a'.repeat(511)}…`);
    expect(result).toHaveLength(512);
  });
});
