jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('S3 signer config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('defaults every S3 signed URL to 12 hours when the env override is absent', () => {
    delete process.env.S3_URL_EXPIRY_SECONDS;
    jest.resetModules();

    const { s3Config } = jest.requireActual('../s3Config') as typeof import('../s3Config');

    expect(s3Config.S3_URL_EXPIRY_SECONDS).toBe(43_200);
  });

  it('keeps the env override and seven-day upper bound', () => {
    process.env.S3_URL_EXPIRY_SECONDS = String(9 * 24 * 60 * 60);
    jest.resetModules();

    const { s3Config } = jest.requireActual('../s3Config') as typeof import('../s3Config');

    expect(s3Config.S3_URL_EXPIRY_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});
