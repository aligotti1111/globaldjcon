'use client';

// TestimonialsTab — up to 5 testimonial cards. Faithful port of
// udjp-testimonials.js + update-dj-profile.html lines 447-451.
//
// In vanilla, this tab is only shown for Mobile DJs. The parent
// UpdateDjProfileClient does the same gating — VendorTabs hides
// the Testimonials button for non-mobile DJs.
//
// Data shape: array of { name, date, blurb }. Cards with no name AND
// no blurb are filtered out at save time (see UpdateDjProfileClient
// payload builder).

import styles from './updateDjProfile.module.css';
import type { GeneralFormState, TestimonialItem } from './UpdateDjProfileClient';

interface Props {
  state: GeneralFormState;
  onChange: <K extends keyof GeneralFormState>(field: K, value: GeneralFormState[K]) => void;
}

const MAX_TESTIMONIALS = 5;

export default function TestimonialsTab({ state, onChange }: Props) {
  function updateCard(idx: number, field: keyof TestimonialItem, val: string) {
    const next = state.testimonials.map((t, i) =>
      i === idx ? { ...t, [field]: val } : t
    );
    onChange('testimonials', next);
  }

  function addCard() {
    if (state.testimonials.length >= MAX_TESTIMONIALS) return;
    onChange('testimonials', [...state.testimonials, { name: '', date: '', blurb: '' }]);
  }

  function removeCard(idx: number) {
    onChange('testimonials', state.testimonials.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <p className={styles.testimonialsHint}>
        Add up to {MAX_TESTIMONIALS} client testimonials to your profile.
      </p>

      <div>
        {state.testimonials.map((t, idx) => (
          <div key={idx} className={styles.testimonialCard}>
            <button
              type="button"
              onClick={() => removeCard(idx)}
              className={styles.testimonialRemove}
              title="Remove testimonial"
            >
              ✕
            </button>

            <label htmlFor={`t-name-${idx}`}>Client Name</label>
            <input
              id={`t-name-${idx}`}
              type="text"
              placeholder="Jane Smith"
              value={t.name}
              onChange={(e) => updateCard(idx, 'name', e.target.value)}
              className={styles.testimonialInput}
            />

            <label htmlFor={`t-date-${idx}`}>Date of Event</label>
            <input
              id={`t-date-${idx}`}
              type="text"
              placeholder="e.g. June 2024"
              value={t.date}
              onChange={(e) => updateCard(idx, 'date', e.target.value)}
              className={styles.testimonialInput}
            />

            <label htmlFor={`t-blurb-${idx}`}>Testimonial</label>
            <textarea
              id={`t-blurb-${idx}`}
              placeholder="Write what the client said..."
              value={t.blurb}
              onChange={(e) => updateCard(idx, 'blurb', e.target.value)}
              className={styles.testimonialTextarea}
            />
          </div>
        ))}
      </div>

      {state.testimonials.length < MAX_TESTIMONIALS && (
        <button type="button" onClick={addCard} className={styles.testimonialAddBtn}>
          + Add Testimonial
        </button>
      )}
    </div>
  );
}
