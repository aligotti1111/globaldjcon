'use client';

import type React from 'react';
import styles from '../profile.module.css';
import { LocationPinIcon } from '../icons';

// Hero name + location identity block. Rendered twice: once inside the
// mobile-only heroNameCol column, once inside the desktop heroInfo block. The
// two are identical except the desktop copy inserts a heroMobileDivider between
// the name/badges and the location — parameterized here via `variant`.
export function HeroIdentity({
  variant,
  name,
  location,
  nameSizeClass,
  nameColor,
  locationColor,
  nameBg,
  locationBg,
  bandSpanStyle,
  nameColorControlEl,
  locationColorControlEl,
  heroBadges,
}: {
  variant: 'mobile' | 'desktop';
  name: string;
  location: string;
  nameSizeClass: string;
  nameColor: string;
  locationColor: string;
  nameBg: string | null;
  locationBg: string | null;
  bandSpanStyle: (hex: string | null, which?: 'name' | 'location') => React.CSSProperties;
  nameColorControlEl: React.ReactNode;
  locationColorControlEl: React.ReactNode;
  heroBadges: React.ReactNode;
}) {
  return (
    <>
      <div className={`${styles.heroName} ${nameSizeClass}`} style={{ color: nameColor }}>
        <span style={bandSpanStyle(nameBg)}>{name}</span>
        {nameColorControlEl}
      </div>
      {heroBadges}
      {variant === 'desktop' && <div className={styles.heroMobileDivider} />}
      {location && (
        <div className={styles.heroLocation} style={{ color: locationColor }}>
          <span style={bandSpanStyle(locationBg, 'location')}><LocationPinIcon /> {location}</span>
          {locationColorControlEl}
        </div>
      )}
    </>
  );
}
