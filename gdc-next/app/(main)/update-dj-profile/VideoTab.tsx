'use client';

// VideoTab — 3 fixed slots for YouTube URLs. Faithful port of
// update-dj-profile.html lines 431-445.

import styles from './updateDjProfile.module.css';
import type { GeneralFormState } from './UpdateDjProfileClient';

interface Props {
  state: GeneralFormState;
  onChange: <K extends keyof GeneralFormState>(field: K, value: GeneralFormState[K]) => void;
}

export default function VideoTab({ state, onChange }: Props) {
  const fields: { key: 'videoUrl1' | 'videoUrl2' | 'videoUrl3'; label: string }[] = [
    { key: 'videoUrl1', label: 'Video URL 1' },
    { key: 'videoUrl2', label: 'Video URL 2' },
    { key: 'videoUrl3', label: 'Video URL 3' },
  ];

  return (
    <div>
      {fields.map(({ key, label }) => (
        <div key={key} className={styles.formGroup}>
          <label htmlFor={`ud-${key}`}>{label}</label>
          <input
            id={`ud-${key}`}
            type="text"
            placeholder="YouTube URL"
            value={state[key]}
            onChange={(e) => onChange(key, e.target.value)}
            className={styles.input}
          />
        </div>
      ))}
    </div>
  );
}
