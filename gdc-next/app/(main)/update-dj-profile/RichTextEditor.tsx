'use client';

// RichTextEditor — the same bold/italic/underline + bullet/check/numbered-list
// toolbar used by PackageEditor's "Package Details" field, packaged as a
// reusable control. Uncontrolled contentEditable (React doesn't play well with
// a controlled contenteditable): the initial value is set once, then onInput
// reports the current innerHTML. Reuses the rte* / pkgField* CSS classes so it
// looks identical to the package editor.

import { useEffect, useRef } from 'react';
import styles from './updateDjProfile.module.css';

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  error = false,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  error?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastSetRef = useRef<string>('');

  // Set the initial HTML once (or on an external reset back to empty). Never on
  // every keystroke — that would move the caret.
  useEffect(() => {
    if (editorRef.current && value !== lastSetRef.current) {
      if (lastSetRef.current === '') {
        editorRef.current.innerHTML = value || '';
        lastSetRef.current = value || '';
      }
    }
  }, [value]);

  function sync() {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastSetRef.current = html;
    onChange(html);
  }

  function execCmd(cmd: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, undefined);
    sync();
  }

  function execCheckList() {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const getContainingUL = (): HTMLUListElement | null => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      let node: Node | null = sel.anchorNode;
      if (!node) return null;
      if (node.nodeType === 3) node = (node as Text).parentElement;
      while (node && node !== el) {
        if ((node as HTMLElement).tagName === 'UL') return node as HTMLUListElement;
        node = (node as HTMLElement).parentElement;
      }
      return null;
    };
    const existingUL = getContainingUL();
    if (existingUL) {
      if (existingUL.classList.contains('gdj-check-list')) {
        document.execCommand('insertUnorderedList', false, undefined);
      } else {
        existingUL.classList.add('gdj-check-list');
      }
    } else {
      document.execCommand('insertUnorderedList', false, undefined);
      const newUL = getContainingUL();
      if (newUL) newUL.classList.add('gdj-check-list');
    }
    sync();
  }

  // Enter inside a list item: split the current <li> at the caret so an item
  // never disappears on Enter (browsers otherwise collapse the list).
  function onEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    let node: Node | null = sel.anchorNode;
    if (node && node.nodeType === 3) node = (node as Text).parentElement;
    let li: HTMLElement | null = node as HTMLElement | null;
    while (li && li !== el && li.tagName !== 'LI') li = li.parentElement;
    if (!li || li.tagName !== 'LI' || !li.parentElement) return;
    e.preventDefault();
    const range = sel.getRangeAt(0);
    const after = document.createRange();
    after.selectNodeContents(li);
    after.setStart(range.endContainer, range.endOffset);
    const frag = after.extractContents();
    const newLi = document.createElement('li');
    if (frag.textContent && frag.textContent.length) newLi.appendChild(frag);
    else newLi.appendChild(document.createElement('br'));
    if (!li.textContent || !li.textContent.length) {
      if (!li.querySelector('br')) li.appendChild(document.createElement('br'));
    }
    li.parentElement.insertBefore(newLi, li.nextSibling);
    const r2 = document.createRange();
    r2.setStart(newLi, 0);
    r2.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r2);
    sync();
  }

  return (
    <div>
      <div className={styles.rteToolbar}>
        <button type="button" onClick={() => execCmd('bold')} className={`${styles.rteBtn} ${styles.rteBtnBold}`}>B</button>
        <button type="button" onClick={() => execCmd('italic')} className={`${styles.rteBtn} ${styles.rteBtnItalic}`}>I</button>
        <button type="button" onClick={() => execCmd('underline')} className={`${styles.rteBtn} ${styles.rteBtnUnder}`}>U</button>
        <span className={styles.rteSeparator} />
        <button type="button" onClick={() => execCmd('insertUnorderedList')} className={styles.rteBtn}>• List</button>
        <button type="button" onClick={execCheckList} className={`${styles.rteBtn} ${styles.rteBtnCheck}`}>✓ List</button>
        <button type="button" onClick={() => execCmd('insertOrderedList')} className={styles.rteBtn}>1. List</button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        data-placeholder={placeholder}
        className={`${styles.rteEditor} ${error ? styles.pkgFieldError : ''}`}
        onKeyDown={onEditorKeyDown}
        onInput={(e) => {
          const html = (e.currentTarget as HTMLDivElement).innerHTML;
          lastSetRef.current = html;
          onChange(html);
        }}
        suppressContentEditableWarning
      />
    </div>
  );
}
