import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Outlet, useLocation, RouterProvider, createMemoryRouter } from 'react-router-dom';
import LeaveSiteWarning from '../LeaveSiteWarning';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => `${key}:localized`,
}));

function Layout() {
  const location = useLocation();
  return (
    <>
      <LeaveSiteWarning />
      <div data-testid="path">{location.pathname}</div>
      <Outlet />
    </>
  );
}

function setup(entries = ['/search', '/c/new']) {
  const router = createMemoryRouter(
    [{ element: <Layout />, children: [{ path: '*', element: <div /> }] }],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

describe('LeaveSiteWarning', () => {
  beforeEach(() => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);
  });

  it('keeps the native unload warning and removes its listener when unmounted', () => {
    const { unmount } = setup();
    const event = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(event, 'returnValue', { value: '', writable: true });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(true);
    expect(event.returnValue).toBe('com_ui_leave_site_warning:localized');
    expect(window.confirm).not.toHaveBeenCalled();

    unmount();
    const afterUnmount = new Event('beforeunload', { cancelable: true });
    fireEvent(window, afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });

  it('cancels browser back on an empty conversation and allows a confirmed retry', async () => {
    const { router } = setup();
    await act(async () => {
      await router.navigate(-1);
    });

    expect(window.confirm).toHaveBeenCalledWith('com_ui_leave_site_warning:localized');
    expect(screen.getByTestId('path')).toHaveTextContent('/c/new');

    jest.mocked(window.confirm).mockReturnValue(true);
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/search'));
    expect(window.confirm).toHaveBeenCalledTimes(2);
  });

  it('warns when browser back switches to another saved conversation', async () => {
    const { router } = setup(['/c/previous', '/c/current']);
    jest.mocked(window.confirm).mockReturnValue(true);
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/c/previous'));
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });

  it.each(['/search', '/share/example', '/catalog'])('does not prompt on %s', async (path) => {
    const { router } = setup(['/c/previous', path]);
    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.getByTestId('path')).toHaveTextContent('/c/previous');
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps ordinary route navigation unchanged (replace: %s)',
    async (replace) => {
      const { router } = setup();
      await act(async () => {
        await router.navigate('/search', { replace });
      });
      expect(screen.getByTestId('path')).toHaveTextContent('/search');
      expect(window.confirm).not.toHaveBeenCalled();
    },
  );
});
