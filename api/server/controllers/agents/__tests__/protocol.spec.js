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
  const configuredProtocol = process.env.GENERATION_PROTOCOL_VERSION;

  afterEach(() => {
    if (configuredProtocol == null) {
      delete process.env.GENERATION_PROTOCOL_VERSION;
    } else {
      process.env.GENERATION_PROTOCOL_VERSION = configuredProtocol;
    }
  });

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

  test('defaults Redis to the bridge protocol and in-memory storage to v2', () => {
    delete process.env.GENERATION_PROTOCOL_VERSION;
    expect(getServerGenerationProtocol({ isRedis: true })).toBe(GENERATION_PROTOCOL_V1);
    expect(getServerGenerationProtocol({ isRedis: false })).toBe(GENERATION_PROTOCOL_V2);
  });

  test('honors an explicit fleet-wide protocol gate', () => {
    process.env.GENERATION_PROTOCOL_VERSION = '2';
    expect(getServerGenerationProtocol({ isRedis: true })).toBe(GENERATION_PROTOCOL_V2);
    process.env.GENERATION_PROTOCOL_VERSION = '1';
    expect(getServerGenerationProtocol({ isRedis: false })).toBe(GENERATION_PROTOCOL_V1);
  });

  test('negotiates new jobs against the server ceiling', () => {
    delete process.env.GENERATION_PROTOCOL_VERSION;
    const req = {
      body: { generationProtocolVersion: 2 },
      headers: { 'x-librechat-generation-protocol': '2' },
    };
    expect(negotiateNewGenerationProtocol(req, { isRedis: true })).toBe(GENERATION_PROTOCOL_V1);
    expect(negotiateNewGenerationProtocol(req, { isRedis: false })).toBe(GENERATION_PROTOCOL_V2);
  });

  test('never upgrades a live v1 job after the global gate flips', () => {
    process.env.GENERATION_PROTOCOL_VERSION = '2';
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
