import useUnsavedChangesPrompt from '~/hooks/Generic/useUnsavedChangesPrompt';
import { useLocalize } from '~/hooks';

export default function LeaveSiteWarning() {
  const localize = useLocalize();

  useUnsavedChangesPrompt({
    when: true,
    message: localize('com_ui_leave_site_warning'),
  });

  return null;
}
