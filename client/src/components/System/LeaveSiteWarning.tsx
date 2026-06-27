import { useCallback } from 'react';
import { useBeforeUnload } from 'react-router-dom';
import { useLocalize } from '~/hooks';

export default function LeaveSiteWarning() {
  const localize = useLocalize();
  const message = localize('com_ui_leave_site_warning');

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
