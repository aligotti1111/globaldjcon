'use client';

import { useState } from 'react';
import type { DjProfileData } from '../profileTypes';

// ── Hero name/location color ────────────────────────────────────────
// Owner-chosen colour applied to the hero name and the location line, plus an
// optional semi-transparent band behind each. Held in local state so the
// owner's colour-picker recolors LIVE, then persisted via /api/dj/profile-color.
// Default is white when unset so nothing changes for existing profiles.
export function useHeroColors(data: DjProfileData) {
  const [nameColor, setNameColor] = useState<string>(data.profile_name_color || '#ffffff');
  // Location now has its OWN text colour (falls back to the name colour if the
  // owner never set one, so existing profiles look unchanged). Plus an optional
  // semi-transparent band behind each of the name and the location, stored as a
  // hex colour (null = no band). All four are independently editable.
  const [locationColor, setLocationColor] = useState<string>(
    data.profile_location_color || data.profile_name_color || '#ffffff',
  );
  const [nameBg, setNameBg] = useState<string | null>(data.profile_name_bg || null);
  const [locationBg, setLocationBg] = useState<string | null>(data.profile_location_bg || null);

  // Persist one field to the DJ's row. `value` null clears it (band off). The
  // route validates and maps the field name → its column.
  async function saveColorField(field: 'name' | 'location' | 'name_bg' | 'location_bg', value: string | null) {
    try {
      await fetch('/api/dj/profile-color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, color: value }),
      });
    } catch {
      // Best-effort; the live colour still applies until reload.
    }
  }
  function handleNameColorChange(color: string) { setNameColor(color); saveColorField('name', color); }
  function handleLocationColorChange(color: string) { setLocationColor(color); saveColorField('location', color); }
  function handleNameBgChange(color: string | null) { setNameBg(color); saveColorField('name_bg', color); }
  function handleLocationBgChange(color: string | null) { setLocationBg(color); saveColorField('location_bg', color); }

  return {
    nameColor,
    locationColor,
    nameBg,
    locationBg,
    handleNameColorChange,
    handleLocationColorChange,
    handleNameBgChange,
    handleLocationBgChange,
  };
}
