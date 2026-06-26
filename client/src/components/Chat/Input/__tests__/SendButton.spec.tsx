import React from 'react';
import { useForm } from 'react-hook-form';
import { render, screen } from '@testing-library/react';
import SendButton from '../SendButton';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    SendIcon: () => R.createElement('span', { 'data-testid': 'send-icon' }),
    TooltipAnchor: ({ render }: { render: React.ReactElement }) => render,
  };
});

function RenderSendButton({
  disabled = false,
  hasFiles = false,
  text = '',
}: {
  disabled?: boolean;
  hasFiles?: boolean;
  text?: string;
}) {
  const methods = useForm<{ text: string }>({
    defaultValues: { text },
  });

  return <SendButton control={methods.control} disabled={disabled} hasFiles={hasFiles} />;
}

describe('SendButton', () => {
  it('stays disabled for empty text without files', () => {
    render(<RenderSendButton />);

    expect(screen.getByTestId('send-button')).toBeDisabled();
  });

  it('is enabled for empty text when files are attached', () => {
    render(<RenderSendButton hasFiles />);

    expect(screen.getByTestId('send-button')).not.toBeDisabled();
  });

  it('is enabled when text is present', () => {
    render(<RenderSendButton text="請 OCR" />);

    expect(screen.getByTestId('send-button')).not.toBeDisabled();
  });
});
