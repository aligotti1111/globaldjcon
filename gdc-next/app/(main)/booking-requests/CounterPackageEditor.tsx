'use client';

// CounterPackageEditor — rich-text editor used inside CounterModal to let
// the DJ modify the package contents when sending a counter offer.
//
// HOW IT WORKS
// 1. Mounts with the original package_details HTML pre-loaded into a
//    contenteditable div.
// 2. DJ edits freely — bold/italic/lists work via the standard
//    document.execCommand toolbar (matches the main PackageEditor).
// 3. On every input we recompute the diff between the ORIGINAL HTML
//    and the current edited HTML, then render a live preview below the
//    editor showing what the host will see.
// 4. Parent (CounterModal) reads the diffed HTML via the onChange
//    callback and saves it to package_details on the booking row.
//
// DESIGN NOTES
// We DON'T put diff markers (<s>/<ins>) into the editor itself — that
// would make every keystroke clobber the in-progress edit. Instead the
// editor stays as a normal rich-text surface and the diff is computed
// on-the-fly from the plain HTML. The diff is only inserted into the
// final saved value when the parent calls onChange(diffedHtml).
//
// The PREVIEW below the editor is the host's view rendered in real time —
// strikethrough for removed text, highlighted for added text. This gives
// the DJ a clear sense of what their counter looks like before sending.

import { useEffect, useRef, useState } from 'react';
import { diffPackageHtml } from './packageDiff';

interface Props {
  // Original package_details (the unedited HTML the booking arrived with).
  // May be empty/null if this is a custom counter without a base package.
  originalHtml: string;
  // Called whenever the DJ's edit produces a new diff. The value passed
  // is the FULL HTML to save: prefixed with the GDJ_EDITED marker, with
  // <s>/<ins> markers inline showing what changed.
  // Note: if the DJ reverts to the original, this is called with the
  // original HTML unchanged (no marker, no diff).
  onChange: (diffedHtml: string) => void;
}

export default function CounterPackageEditor({ originalHtml, onChange }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  // The plain (non-diffed) HTML currently in the editor. Tracked in
  // state so the preview stays in sync without forcing the editor to
  // re-render on every input (which would reset the cursor).
  const [currentHtml, setCurrentHtml] = useState(originalHtml || '');
  // Initialize the editor content ONCE on mount. After that we never
  // touch innerHTML programmatically — react would lose the cursor.
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!editorRef.current || initializedRef.current) return;
    editorRef.current.innerHTML = originalHtml || '';
    initializedRef.current = true;
  }, [originalHtml]);

  function syncFromEditor() {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    setCurrentHtml(html);
    onChange(diffPackageHtml(originalHtml || '', html));
  }

  // Toolbar commands — same execCommand approach as PackageEditor on the
  // DJ profile. execCommand is deprecated but still works in all current
  // browsers and is dramatically simpler than implementing a custom
  // selection-based formatter.
  function exec(cmd: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, undefined);
    syncFromEditor();
  }

  // Reset to the original — handy for undoing a chain of edits.
  function resetToOriginal() {
    if (!editorRef.current) return;
    editorRef.current.innerHTML = originalHtml || '';
    setCurrentHtml(originalHtml || '');
    onChange(originalHtml || '');
  }

  const hasEdits = currentHtml.trim() !== (originalHtml || '').trim();
  const previewHtml = hasEdits
    ? diffPackageHtml(originalHtml || '', currentHtml)
    : '';

  return (
    <div className="cpe-root">
      <div className="cpe-toolbar">
        <button type="button" onClick={() => exec('bold')} className="cpe-tbtn" aria-label="Bold">
          <strong>B</strong>
        </button>
        <button type="button" onClick={() => exec('italic')} className="cpe-tbtn" aria-label="Italic">
          <em>I</em>
        </button>
        <button type="button" onClick={() => exec('underline')} className="cpe-tbtn" aria-label="Underline">
          <u>U</u>
        </button>
        <span className="cpe-tsep" />
        <button type="button" onClick={() => exec('insertUnorderedList')} className="cpe-tbtn" aria-label="Bullet list">
          • List
        </button>
        <button type="button" onClick={() => exec('insertOrderedList')} className="cpe-tbtn" aria-label="Numbered list">
          1. List
        </button>
        <span className="cpe-tspacer" />
        {hasEdits && (
          <button
            type="button"
            onClick={resetToOriginal}
            className="cpe-treset"
            aria-label="Reset to original"
          >
            Reset
          </button>
        )}
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={syncFromEditor}
        className="cpe-editor"
        // Block Enter from submitting the parent form — the DJ wants to
        // create a new line, not send the counter offer.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            // Allow cmd/ctrl-enter to bubble up if parent wants to handle
            return;
          }
          // Default Enter creates a paragraph break — let it.
        }}
      />

      {hasEdits && previewHtml && (
        <div className="cpe-previewBlock">
          <div className="cpe-previewLabel">Preview (what the host will see)</div>
          <div
            className="cpe-preview"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
          <div className="cpe-legend">
            <span className="cpe-legendChip cpe-legendAdd">added</span>
            <span className="cpe-legendChip cpe-legendRemove">removed</span>
          </div>
        </div>
      )}

      {/* Component-scoped CSS using a style tag. Keeps this drop-in
          self-contained without needing a separate .module.css file. */}
      <style>{`
        .cpe-root {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cpe-toolbar {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-wrap: wrap;
          padding: 6px 8px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px 8px 0 0;
        }
        .cpe-tbtn {
          background: transparent;
          color: #ccc;
          border: 1px solid transparent;
          padding: 4px 8px;
          font-size: 12px;
          cursor: pointer;
          border-radius: 4px;
          font-family: inherit;
        }
        .cpe-tbtn:hover {
          background: rgba(255,255,255,0.08);
          color: #fff;
        }
        .cpe-tsep {
          width: 1px;
          height: 18px;
          background: rgba(255,255,255,0.12);
          margin: 0 4px;
        }
        .cpe-tspacer { flex: 1; }
        .cpe-treset {
          background: transparent;
          color: #f59e0b;
          border: 1px solid rgba(245,158,11,0.4);
          padding: 4px 10px;
          font-size: 11px;
          cursor: pointer;
          border-radius: 4px;
          font-family: inherit;
        }
        .cpe-treset:hover {
          background: rgba(245,158,11,0.12);
        }
        .cpe-editor {
          min-height: 120px;
          max-height: 320px;
          overflow-y: auto;
          padding: 10px 12px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-top: none;
          border-radius: 0 0 8px 8px;
          color: #ddd;
          font-size: 13px;
          line-height: 1.5;
          outline: none;
        }
        .cpe-editor:focus {
          border-color: rgba(16,185,129,0.5);
        }
        .cpe-editor ul, .cpe-editor ol {
          padding-left: 24px;
          margin: 6px 0;
        }
        .cpe-editor p { margin: 4px 0; }

        .cpe-previewBlock {
          margin-top: 8px;
          padding: 10px 12px;
          background: rgba(255,255,255,0.02);
          border: 1px dashed rgba(255,255,255,0.12);
          border-radius: 8px;
        }
        .cpe-previewLabel {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #888;
          margin-bottom: 6px;
        }
        .cpe-preview {
          color: #ddd;
          font-size: 13px;
          line-height: 1.5;
        }
        .cpe-preview ul, .cpe-preview ol {
          padding-left: 24px;
          margin: 6px 0;
        }
        .cpe-preview p { margin: 4px 0; }
        /* Diff styling — these classes are emitted by packageDiff.ts and
           also need to be matched in the public-facing render of the
           booking card so the host sees the same diff treatment. */
        .cpe-preview ins.gdj-diff-add,
        ins.gdj-diff-add {
          background: rgba(16,185,129,0.2);
          color: #6ee7b7;
          text-decoration: none;
          padding: 0 2px;
          border-radius: 2px;
        }
        .cpe-preview s.gdj-diff-remove,
        s.gdj-diff-remove {
          color: #f87171;
          opacity: 0.8;
        }
        .cpe-legend {
          display: flex;
          gap: 8px;
          margin-top: 8px;
          font-size: 10px;
        }
        .cpe-legendChip {
          padding: 2px 6px;
          border-radius: 3px;
        }
        .cpe-legendAdd {
          background: rgba(16,185,129,0.2);
          color: #6ee7b7;
        }
        .cpe-legendRemove {
          background: rgba(248,113,113,0.15);
          color: #f87171;
          text-decoration: line-through;
        }
      `}</style>
    </div>
  );
}
