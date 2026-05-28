import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SteelOAuthChat from './SteelOAuthChat';

const mockSendSteelChat = jest.fn();

jest.mock('librechat-data-provider', () => ({
  dataService: {
    sendSteelChat: (...args: unknown[]) => mockSendSteelChat(...args),
  },
}));

describe('SteelOAuthChat', () => {
  beforeEach(() => {
    mockSendSteelChat.mockReset();
    mockSendSteelChat.mockResolvedValue({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.4',
      text: 'file-ok',
      unsupportedSettings: [],
      warnings: [],
    });
  });

  it('sends selected files as browser-safe base64 payloads', async () => {
    const user = userEvent.setup();
    const file = new File(['Steel OAuth capability smoke'], 'steel-oauth-smoke.txt', {
      type: 'text/plain',
    });

    render(<SteelOAuthChat />);

    await user.upload(screen.getByLabelText('Attach files'), file);
    await user.type(screen.getByPlaceholderText('Message Steel'), 'Read the attachment.');
    await user.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(mockSendSteelChat).toHaveBeenCalledTimes(1);
    });
    expect(mockSendSteelChat).toHaveBeenCalledWith({
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      messages: [
        {
          role: 'user',
          content: 'Read the attachment.',
          files: [
            {
              filename: 'steel-oauth-smoke.txt',
              mediaType: 'text/plain',
              dataBase64: 'U3RlZWwgT0F1dGggY2FwYWJpbGl0eSBzbW9rZQ==',
            },
          ],
        },
      ],
    });
  });

  it('sends the selected reasoning effort with each chat request', async () => {
    const user = userEvent.setup();

    render(<SteelOAuthChat />);

    await user.click(screen.getByRole('button', { name: 'high' }));
    await user.type(screen.getByPlaceholderText('Message Steel'), 'Read carefully.');
    await user.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(mockSendSteelChat).toHaveBeenCalledTimes(1);
    });
    expect(mockSendSteelChat).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoningEffort: 'high',
      }),
    );
  });

  it('starts a new local chat without changing the selected model or reasoning effort', async () => {
    const user = userEvent.setup();

    render(<SteelOAuthChat />);

    await user.click(screen.getByRole('button', { name: 'gpt-5.5' }));
    await user.click(screen.getByRole('button', { name: 'xhigh' }));
    await user.type(screen.getByPlaceholderText('Message Steel'), 'First message.');
    await user.click(screen.getByLabelText('Send'));

    await screen.findByText('file-ok');

    await user.click(screen.getByRole('button', { name: 'New chat' }));

    expect(screen.queryByText('First message.')).not.toBeInTheDocument();
    expect(screen.queryByText('file-ok')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Message Steel'), 'Second message.');
    await user.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(mockSendSteelChat).toHaveBeenCalledTimes(2);
    });
    expect(mockSendSteelChat).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        messages: [
          {
            role: 'user',
            content: 'Second message.',
          },
        ],
      }),
    );
  });
});
