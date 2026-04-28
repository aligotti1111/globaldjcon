'use client';

// MixesTab — 3 fixed slots for SoundCloud / Mixcloud URLs. Faithful port
// of update-dj-profile.html lines 333-348.
//
// Vanilla just persists the raw URL string per slot; the public profile
// page handles iframe embedding via the existing embed parser. We don't
// preview anything here.

import styles from './updateDjProfile.module.css';
import type { GeneralFormState } from './UpdateDjProfileClient';

interface Props {
  state: GeneralFormState;
  onChange: <K extends keyof GeneralFormState>(field: K, value: GeneralFormState[K]) => void;
}

export default function MixesTab({ state, onChange }: Props) {
  const fields: { key: 'mixUrl1' | 'mixUrl2' | 'mixUrl3'; label: string }[] = [
    { key: 'mixUrl1', label: 'Mix / Audio URL 1' },
    { key: 'mixUrl2', label: 'Mix / Audio URL 2' },
    { key: 'mixUrl3', label: 'Mix / Audio URL 3' },
  ];

  return (
    <div>
      {fields.map(({ key, label }) => (
        <div key={key} className={styles.formGroup}>
          <label htmlFor={`ud-${key}`}>{label}</label>
          <input
            id={`ud-${key}`}
            type="text"
            placeholder="SoundCloud or Mixcloud URL"
            value={state[key]}
            onChange={(e) => onChange(key, e.target.value)}
            className={styles.input}
          />
        </div>
      ))}
    </div>
  );
}
