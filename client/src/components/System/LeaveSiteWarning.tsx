import { useEffect, useCallback } from 'react';
import { useBlocker, useBeforeUnload } from 'react-router-dom';
import { useLocalize } from '~/hooks';

export default function LeaveSiteWarning() {
  const localize = useLocalize();
  const message = localize('com_ui_leave_site_warning');
  const blocker = useBlocker(
    ({ currentLocation, historyAction }) =>
      historyAction === 'POP' && /^\/c(?:\/|$)/.test(currentLocation.pathname),
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      return;
    }

    if (!window.confirm(message)) {
      blocker.reset();
      return;
    }

    // Let the router restore the current history entry before retrying the navigation.
    const timeout = window.setTimeout(blocker.proceed, 0);
    return () => window.clearTimeout(timeout);
  }, [blocker, message]);

  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = message;
      },
      [message],
    ),
    { capture: true },
  );

  return null;
}
