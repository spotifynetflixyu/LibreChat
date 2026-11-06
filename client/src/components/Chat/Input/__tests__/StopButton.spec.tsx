import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import StopButton from '../StopButton';

describe('StopButton', () => {
  it('renders normal stop generating label when no Steel flow is running', () => {
    const stop = jest.fn();
    const setShowStopButton = jest.fn();

    render(<StopButton stop={stop} setShowStopButton={setShowStopButton} />);

    const button = screen.getByTestId('stop-generation-button');
    expect(button).toHaveAttribute('aria-label', 'Stop generating');

    fireEvent.click(button);
    expect(setShowStopButton).toHaveBeenCalledWith(false);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('renders pause flow label when a Steel flow is actively running', () => {
    const stop = jest.fn();
    const setShowStopButton = jest.fn();

    render(
      <StopButton
        stop={stop}
        setShowStopButton={setShowStopButton}
        isSteelFlowRunning={true}
      />,
    );

    const button = screen.getByTestId('stop-generation-button');
    expect(button).toHaveAttribute('aria-label', 'Pause flow');

    fireEvent.click(button);
    expect(setShowStopButton).toHaveBeenCalledWith(false);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
