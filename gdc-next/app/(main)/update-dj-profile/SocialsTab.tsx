'use client';

// SocialsTab — Website + SoundCloud + Instagram + TikTok + Facebook + Twitch.
// Faithful port of update-dj-profile.html lines 306-331. Inline SVG icons
// match vanilla; we keep the same visual order.

import styles from './updateDjProfile.module.css';
import type { GeneralFormState } from './UpdateDjProfileClient';

interface Props {
  state: GeneralFormState;
  onChange: <K extends keyof GeneralFormState>(field: K, value: GeneralFormState[K]) => void;
}

// Inline SVG icon definitions — kept here rather than in a separate icons
// file because they're only used in this tab. Each is sized 16x16 and
// styled via currentColor to inherit the label's text color.

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  );
}

function SoundCloudIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M1.175 12.225c-.056 0-.094.06-.102.133l-.233 2.154.233 2.105c.008.074.046.13.102.13.05 0 .09-.05.104-.13l.266-2.105-.27-2.154c-.014-.08-.056-.133-.1-.133zm1.81-.49c-.064 0-.11.055-.12.135l-.198 2.644.198 2.477c.01.08.056.13.12.13.067 0 .112-.05.125-.13l.224-2.477-.224-2.644c-.013-.08-.057-.135-.125-.135zm1.81.263c-.072 0-.124.058-.133.14l-.177 2.38.177 2.346c.009.082.06.14.133.14.074 0 .125-.06.138-.14l.2-2.346-.2-2.38c-.013-.082-.064-.14-.138-.14zm9.583-4.603c-.297 0-.59.06-.86.175-.18-2.06-1.894-3.663-3.99-3.663-.548 0-1.076.11-1.552.32-.18.076-.228.154-.23.225v7.24c.002.073.055.133.13.14h6.5c.72 0 1.303-.583 1.303-1.302v-.006c0-.72-.583-1.302-1.3-1.302z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.75a4.85 4.85 0 01-1.01-.06z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />
    </svg>
  );
}

function TwitchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
    </svg>
  );
}

export default function SocialsTab({ state, onChange }: Props) {
  // Render the 6 social fields in the same order as vanilla. Each row uses
  // .formGroup wrapping but with an inline-flex label so the SVG sits next
  // to the field name.
  const fields: {
    key: keyof GeneralFormState;
    label: string;
    placeholder: string;
    icon: React.ReactNode;
  }[] = [
    { key: 'website', label: 'Website', placeholder: 'e.g. https://yoursite.com', icon: <GlobeIcon /> },
    { key: 'soundcloud', label: 'SoundCloud', placeholder: 'e.g. https://soundcloud.com/yourname', icon: <SoundCloudIcon /> },
    { key: 'instagram', label: 'Instagram', placeholder: 'e.g. @djyourname', icon: <InstagramIcon /> },
    { key: 'tiktok', label: 'TikTok', placeholder: 'e.g. @djyourname', icon: <TikTokIcon /> },
    { key: 'facebook', label: 'Facebook', placeholder: 'e.g. https://facebook.com/yourpage', icon: <FacebookIcon /> },
    { key: 'twitch', label: 'Twitch', placeholder: 'e.g. https://twitch.tv/yourname', icon: <TwitchIcon /> },
  ];

  return (
    <div>
      {fields.map(({ key, label, placeholder, icon }) => (
        <div key={key} className={styles.formGroup}>
          <label
            htmlFor={`ud-${key}`}
            style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}
          >
            {icon}
            {label}
          </label>
          <input
            id={`ud-${key}`}
            type="text"
            placeholder={placeholder}
            value={(state[key] as string) || ''}
            onChange={(e) => onChange(key, e.target.value as GeneralFormState[typeof key])}
            className={styles.input}
          />
        </div>
      ))}
    </div>
  );
}
