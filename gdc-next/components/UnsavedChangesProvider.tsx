'use client';

// UnsavedChangesProvider — global guard that intercepts in-app navigation
// while a page has registered itself as having unsaved changes. Captures
// clicks on internal anchor elements at the document level, prompts the
// user via the existing ConfirmModal, and only proceeds with the
// navigation if they confirm. Also re-arms the native beforeunload prompt
// for tab close / refresh / external nav.
//
// Usage from any page that has unsaved-changes state:
//   const { setDirty } = useUnsavedChanges();
//   useEffect(() => { setDirty(isPageDirty); }, [isPageDirty, setDirty]);
//   // also call setDirty(false) right after a successful save
//
// Pages that can name WHAT is unsaved may pass a second argument — a list of
// labels — and the leave prompt lists them, each with a small amber dot.
//
// The provider is mounted once near the root of the app (in (main)/layout
// where the header/burger live). The (simple) routes (login, signup,
// claim, contact, privacy, terms, set-password, reset-password,
// forgot-password) don't need it — they don't host edit forms.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useConfirm } from './ConfirmModal';

interface Ctx {
  /** Register or clear the current page's dirty state. Pass `true` to
   *  arm the guard, `false` to disarm. Optionally pass a list of labels
   *  naming what's unsaved — the leave prompt lists them with amber dots.
   *  Safe to call from a useEffect whenever your dirty flag changes. */
  setDirty: (dirty: boolean, items?: string[]) => void;
}

const UnsavedChangesContext = createContext<Ctx | null>(null);

export function useUnsavedChanges(): Ctx {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) {
    // Returning a no-op when there's no provider lets pages call this
    // unconditionally without crashing in environments (tests, simple
    // routes) where the provider isn't mounted.
    return { setDirty: () => {} };
  }
  return ctx;
}

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { confirm, confirmDialog } = useConfirm();
  // Track dirty as both state (so effects re-run when it changes) and a
  // ref (so the document-level click handler reads the latest value
  // without needing to be re-attached on every change).
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  // The labels of what's currently unsaved (optional) — read at prompt time.
  const dirtyItemsRef = useRef<string[]>([]);
  const pathRef = useRef(pathname);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const setDirty = useCallback((d: boolean, items?: string[]) => {
    dirtyRef.current = d;
    dirtyItemsRef.current = Array.isArray(items) ? items : [];
    setDirtyState(d);
  }, []);

  // Builds the confirm-modal body from whatever's currently unsaved. Shared by
  // the in-app link interceptor and the browser back-button interceptor so both
  // show the same styled list (amber dot to the left of each item).
  const buildLeaveMessage = useCallback((): React.ReactNode => {
    const items = dirtyItemsRef.current;
    if (items.length === 0) {
      return 'You have unsaved changes on your profile. If you leave now, those changes will be lost.';
    }
    return (
      <div>
        <div style={{ marginBottom: 10 }}>
          You have unsaved changes. If you leave now, these will be lost:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {items.map((label) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f5c451', flexShrink: 0 }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }, []);

  // Native browser warning on tab close / refresh / external nav. Modern
  // browsers ignore custom messages and show their generic prompt — but
  // setting returnValue is required for the prompt to fire at all.
  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Global click interception for in-app navigation. We attach a single
  // capture-phase listener on document and check whether the click landed
  // on an anchor that would navigate the user to a different pathname.
  // Capture-phase is important — Next.js Link's own click handler runs
  // in the bubble phase, so by intercepting in capture we can stop it
  // before it triggers client-side navigation.
  useEffect(() => {
    function onClickCapture(e: MouseEvent) {
      if (!dirtyRef.current) return;
      // Respect modifier-keys (open-in-new-tab, etc.) — let those through.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.button !== 0) return; // only left click
      // Find the nearest <a> ancestor.
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      // Skip external links, mailto, tel, and explicit new-tab links.
      if (anchor.target === '_blank') return;
      if (/^(https?:)?\/\//.test(href) && !href.startsWith(window.location.origin)) return;
      if (href.startsWith('mailto:') || href.startsWith('tel:')) return;
      // Resolve to a pathname for comparison.
      let nextPath: string;
      try {
        const url = new URL(href, window.location.origin);
        nextPath = url.pathname + url.search + url.hash;
      } catch {
        return;
      }
      // Same-page anchor (just a hash on current pathname) — let it
      // through, no real navigation.
      if (nextPath.startsWith('#')) return;
      const currentPath = pathRef.current || '/';
      const currentFull = currentPath;
      if (nextPath === currentFull) return; // navigating to same path

      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const ok = await confirm({
          title: 'Leave without saving?',
          message: buildLeaveMessage(),
          confirmLabel: 'Leave',
          cancelLabel: 'Stay',
          variant: 'danger',
        });
        if (ok) {
          // Clear dirty so the next nav passes through cleanly, then
          // do the navigation the user originally requested.
          dirtyRef.current = false;
          router.push(nextPath);
        }
      })();
    }
    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [confirm, router, buildLeaveMessage]);

  // Browser back / forward button interception. Native beforeunload only
  // fires for tab-close / refresh / external nav, not for in-app history
  // pops — so a hardware Back press would silently discard edits. We arm a
  // history "sentinel" while dirty: an extra entry that the first Back press
  // pops instead of leaving the page. On that pop we re-push the sentinel to
  // hold position and show the same styled confirm modal. Only when the user
  // confirms do we actually navigate back past both the sentinel and the
  // real page. This is scoped to the dirty window and torn down on save, so
  // it doesn't affect back navigation once there's nothing to lose.
  useEffect(() => {
    if (!dirty) return;
    // Push one sentinel entry to absorb the first Back press.
    window.history.pushState({ __unsavedGuard: true }, '');
    let handling = false;

    function onPopState() {
      if (!dirtyRef.current) return; // nothing to protect — allow the pop
      if (handling) return;
      handling = true;
      // The pop landed us back on the real page entry; re-push the sentinel
      // so the user visually stays put while the modal is open.
      window.history.pushState({ __unsavedGuard: true }, '');
      void (async () => {
        const ok = await confirm({
          title: 'Leave without saving?',
          message: buildLeaveMessage(),
          confirmLabel: 'Leave',
          cancelLabel: 'Stay',
          variant: 'danger',
        });
        handling = false;
        if (ok) {
          dirtyRef.current = false;
          window.removeEventListener('popstate', onPopState);
          // Go back past the sentinel we just re-pushed AND the real page
          // entry, landing on wherever the user actually wanted to go.
          window.history.go(-2);
        }
        // On cancel we leave the sentinel in place — still armed for the
        // next Back press.
      })();
    }

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      // Best-effort cleanup: if we're still sitting on our sentinel entry
      // when the guard disarms (e.g. after a successful save), step back off
      // it so we don't leave a dead history entry that needs an extra Back
      // press. Guarded by the state flag so we don't navigate mid-prompt.
      if (!handling && window.history.state && window.history.state.__unsavedGuard) {
        window.history.back();
      }
    };
  }, [dirty, confirm, buildLeaveMessage]);

  return (
    <UnsavedChangesContext.Provider value={{ setDirty }}>
      {children}
      {confirmDialog}
    </UnsavedChangesContext.Provider>
  );
}
