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
   *  arm the guard, `false` to disarm. Safe to call from a useEffect
   *  whenever your dirty flag changes. */
  setDirty: (dirty: boolean) => void;
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
  const pathRef = useRef(pathname);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
    setDirtyState(d);
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
          message: 'You have unsaved changes on your profile. If you leave now, those changes will be lost.',
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
  }, [confirm, router]);

  // Note on browser back button: we intentionally don't try to intercept
  // popstate. The "push a sentinel + absorb the pop" pattern can corrupt
  // the browser history stack and break back navigation site-wide. The
  // click interceptor above catches in-app link nav (burger menu, header
  // logo, back link) and beforeunload catches tab close / refresh /
  // external nav. Browser hardware back from inside this page is the one
  // gap — acceptable given the alternative's risk.

  return (
    <UnsavedChangesContext.Provider value={{ setDirty }}>
      {children}
      {confirmDialog}
    </UnsavedChangesContext.Provider>
  );
}
