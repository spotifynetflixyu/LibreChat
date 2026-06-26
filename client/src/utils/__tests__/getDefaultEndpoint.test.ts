import { EModelEndpoint } from 'librechat-data-provider';
import getDefaultEndpoint from '../getDefaultEndpoint';
import { getLocalStorageItems } from '../localStorage';

jest.mock('../localStorage', () => ({
  getLocalStorageItems: jest.fn(),
}));

const mockGetLocalStorageItems = getLocalStorageItems as jest.Mock;

describe('getDefaultEndpoint', () => {
  beforeEach(() => {
    mockGetLocalStorageItems.mockReturnValue({
      lastConversationSetup: {},
    });
  });

  it('uses OpenAI OAuth as the first default endpoint when no setup is stored', () => {
    expect(
      getDefaultEndpoint({
        convoSetup: {},
        endpointsConfig: {
          [EModelEndpoint.openAIOAuth]: {
            type: EModelEndpoint.openAI,
            userProvide: false,
            order: 0,
          },
          [EModelEndpoint.openAI]: {
            userProvide: false,
            order: 1,
          },
        },
      }),
    ).toBe(EModelEndpoint.openAIOAuth);
  });

  it('preserves an explicit conversation endpoint over the default order', () => {
    expect(
      getDefaultEndpoint({
        convoSetup: {
          endpoint: EModelEndpoint.openAI,
        },
        endpointsConfig: {
          [EModelEndpoint.openAIOAuth]: {
            type: EModelEndpoint.openAI,
            userProvide: false,
            order: 0,
          },
          [EModelEndpoint.openAI]: {
            userProvide: false,
            order: 1,
          },
        },
      }),
    ).toBe(EModelEndpoint.openAI);
  });
});
