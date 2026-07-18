'use client';

// The only interactive thing on the sheet, and it exists because `window.print`
// needs a click and a server component can't give it one.
//
// It prints ITSELF away — see .noPrint in the stylesheet. A "Print" button on a
// printed page is the kind of detail that makes the whole sheet look like a
// screenshot of an app rather than a document.

import styles from './sheet.module.css';

export default function PrintButton() {
  return (
    <button
      type="button"
      className={`${styles.print} ${styles.noPrint}`}
      onClick={() => window.print()}
    >
      Print / save PDF
    </button>
  );
}
