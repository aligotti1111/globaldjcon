'use client';

// Homepage client component — owns all the interactive bits that vanilla's
// idx-filters.js + idx-render.js + idx-init.js handled.
//
// State:
//   - searchTerm + 600ms debounce → if zip/numeric, geocode via Nominatim
//     and switch to nearest-sort
//   - activeFilters (mobile, club) — pill toggles
//   - viewMode (grid | list)
//   - userLocation — populated by zip search OR Find Near Me geolocation
//   - sortMode — name | nearest
//   - activeCountry — defaults to 'United States', flag-picker swappable
//
// Filter rules (vanilla parity):
//   - Type: keep DJ if their dj_type is in activeFilters
//   - Country: keep if dj.country matches activeCountry (or dj.country is null)
//   - Search: zip-style (digits) → geocode; otherwise text match on name/zip
//   - Distance: when userLocation present and search looks like zip, drop
//     DJs whose travel_distance can't reach (with 10mi grace)
//
// Card structure: matches vanilla cardHTML exactly so the global index.css
// styling carries over without any module-CSS overrides. Avatar lives in
// .card-top with the type-badge to its right; .dj-name + .dj-city sit
// BELOW card-top — that's why the previous version had the avatar
// hovering over the text.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────
export interface HomeDj {
  id: string;
  name: string | null;
  slug: string | null;
  dj_type: 'mobile' | 'club' | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zip: string | null;
  avatar_url: string | null;
  rate: string | null;
  travel_distance: string | null;
  booking_settings: string | null;
  profile_private: boolean | null;
  // Client-side caches (populated as we geocode)
  _coords?: { lat: number; lng: number };
  _distance?: number;
}

interface Props {
  initialDjs: HomeDj[];
}

// ─── Country data — same as vanilla idx-filters.js ────────────────
const COUNTRY_CODES: Record<string, string> = {
  'United States': 'us', 'United Kingdom': 'gb', 'Canada': 'ca',
  'Australia': 'au', 'Germany': 'de', 'France': 'fr', 'Netherlands': 'nl',
  'Spain': 'es', 'Italy': 'it', 'Brazil': 'br', 'Mexico': 'mx', 'Japan': 'jp',
  'South Africa': 'za', 'New Zealand': 'nz', 'Ireland': 'ie', 'Sweden': 'se',
  'Norway': 'no', 'Denmark': 'dk', 'Belgium': 'be', 'Switzerland': 'ch',
  'Portugal': 'pt',
};

const COUNTRY_FLAGS: Record<string, string> = {
  'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Canada': '🇨🇦',
  'Australia': '🇦🇺', 'Germany': '🇩🇪', 'France': '🇫🇷', 'Netherlands': '🇳🇱',
  'Spain': '🇪🇸', 'Italy': '🇮🇹', 'Brazil': '🇧🇷', 'Mexico': '🇲🇽',
  'Japan': '🇯🇵', 'South Africa': '🇿🇦', 'New Zealand': '🇳🇿',
  'Ireland': '🇮🇪', 'Sweden': '🇸🇪', 'Norway': '🇳🇴', 'Denmark': '🇩🇰',
  'Belgium': '🇧🇪', 'Switzerland': '🇨🇭', 'Portugal': '🇵🇹', 'Other': '🌍',
};
const COUNTRY_NAMES = Object.keys(COUNTRY_FLAGS);

// ─── Helpers ──────────────────────────────────────────────────────
function calcDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3959; // miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeQuery(query: string, countryCode: string): Promise<{ lat: number; lng: number } | null> {
  if (!query) return null;
  const isZip = /^\d{4,10}$/.test(query.trim());
  const cc = countryCode || '';
  const url = isZip
    ? `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(query)}${cc ? '&countrycodes=' + cc : ''}&format=json&limit=1`
    : `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}${cc ? '&countrycodes=' + cc : ''}&format=json&limit=1`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data && data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (e) {
    console.error('Geocode error:', e);
  }
  return null;
}

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.charAt(0).toUpperCase();
}

// Avatar gradient: same colors used across the site for mobile vs club DJs.
function avatarGradient(djType: string | null): string {
  if (djType === 'club') return 'linear-gradient(135deg, #f5e642, #ffb347)';
  return 'linear-gradient(135deg, #00f5c4, #00bfa6)';
}

// ─── Component ────────────────────────────────────────────────────
export default function HomeClient({ initialDjs }: Props) {
  // We mutate the DJs array (caching _coords, _distance) so we keep our
  // own working copy. New DJ data only comes from a page refresh — we
  // don't refetch in the client.
  const djsRef = useRef<HomeDj[]>(initialDjs);

  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    () => new Set(['mobile', 'club'])
  );
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sortMode, setSortMode] = useState<'name' | 'nearest'>('name');
  const [activeCountry, setActiveCountry] = useState('United States');
  const [showCountryMenu, setShowCountryMenu] = useState(false);
  const [nearMeStatus, setNearMeStatus] = useState<'idle' | 'getting' | 'geocoding' | 'found' | 'error'>('idle');

  // How many cards to show. Defaults to 100 — Show More adds another 100.
  // Reset to 100 whenever filters/search change.
  const [visibleCount, setVisibleCount] = useState(100);

  // Progress while geocoding DJ zips after Near Me / zip search.
  // Format: { done, total } so we can show "Loaded 12/87".
  const [geocodeProgress, setGeocodeProgress] = useState<{ done: number; total: number } | null>(null);

  // Force re-render when distances are cached on djs (a setState trigger
  // since we mutate djsRef.current in place during async geocoding).
  const [distanceVersion, setDistanceVersion] = useState(0);

  // ─── Search debounce — geocode if it looks like a zip ────────────
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const q = searchTerm.trim();
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (q.length < 3) {
      // Reset location if it was set by an earlier zip search and they
      // now have an empty/short search
      if (q.length === 0 && userLocation && sortMode === 'nearest') {
        setUserLocation(null);
        setSortMode('name');
      }
      return;
    }

    const looksLikeLocation = /\d/.test(q);
    if (!looksLikeLocation) {
      // Plain name/text search — clear distance, sort by name
      if (userLocation) setUserLocation(null);
      if (sortMode === 'nearest') setSortMode('name');
      return;
    }

    // Geocode after 600ms idle
    searchTimerRef.current = setTimeout(async () => {
      const cc = COUNTRY_CODES[activeCountry] || '';
      const coords = await geocodeQuery(q, cc);
      if (coords) {
        setUserLocation(coords);
        setSortMode('nearest');
      }
    }, 600);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchTerm, activeCountry, userLocation, sortMode]);

  // ─── When userLocation changes, geocode each DJ's zip/city for distance.
  // Fire-and-forget per DJ; bump distanceVersion when each batch lands so
  // the UI re-renders with the populated _distance values.
  // We also track progress so the user sees "Loaded X/Y" while batches run.
  useEffect(() => {
    if (!userLocation) {
      setGeocodeProgress(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const todo = djsRef.current.filter((dj) => !dj._coords && (dj.zip || dj.city));
      const total = todo.length;
      // If all DJs already have coords cached, we can compute distances
      // immediately without any network calls.
      if (total === 0) {
        djsRef.current.forEach((dj) => {
          if (dj._coords) {
            dj._distance = calcDistance(userLocation.lat, userLocation.lng, dj._coords.lat, dj._coords.lng);
          }
        });
        setDistanceVersion((v) => v + 1);
        setGeocodeProgress(null);
        if (nearMeStatus === 'geocoding') setNearMeStatus('found');
        return;
      }
      setGeocodeProgress({ done: 0, total });
      let done = 0;
      // Batch: 5 at a time so we don't spam Nominatim
      for (let i = 0; i < todo.length; i += 5) {
        if (cancelled) return;
        const batch = todo.slice(i, i + 5);
        await Promise.all(batch.map(async (dj) => {
          const target = dj.zip || dj.city || '';
          const cc = COUNTRY_CODES[dj.country || ''] || '';
          const coords = await geocodeQuery(target, cc);
          if (coords) dj._coords = coords;
        }));
        if (!cancelled) {
          // Compute distances + bump version after each batch so cards
          // show up progressively
          djsRef.current.forEach((dj) => {
            if (dj._coords) {
              dj._distance = calcDistance(userLocation.lat, userLocation.lng, dj._coords.lat, dj._coords.lng);
            }
          });
          done += batch.length;
          setGeocodeProgress({ done, total });
          setDistanceVersion((v) => v + 1);
        }
      }
      if (!cancelled) {
        setGeocodeProgress(null);
        if (nearMeStatus === 'geocoding') setNearMeStatus('found');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation]);

  // Reset pagination whenever filters/search/country change so users don't
  // get stuck looking at a paginated subset of stale results.
  useEffect(() => {
    setVisibleCount(100);
  }, [searchTerm, activeFilters, activeCountry]);

  // ─── Pill filter toggle ───────────────────────────────────────────
  function togglePill(filter: 'mobile' | 'club') {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        // Don't allow removing the last active filter — vanilla parity
        if (next.size > 1) next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  }

  // ─── Find Near Me — geolocation API ───────────────────────────────
  function findNearMe() {
    if (!('geolocation' in navigator)) {
      alert('Geolocation not supported by your browser');
      return;
    }
    setNearMeStatus('getting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSortMode('nearest');
        // After we have the coords, the geocode useEffect kicks off and
        // sets nearMeStatus to 'found' once it's done. Show 'geocoding'
        // in the meantime so the user knows something's happening.
        setNearMeStatus('geocoding');
        setVisibleCount(100); // reset pagination on new search
      },
      () => {
        alert('Could not get your location. Please search by zip code instead.');
        setNearMeStatus('error');
      }
    );
  }

  // ─── Filter + sort the visible list ───────────────────────────────
  const visibleDjs = useMemo(() => {
    // distanceVersion is in deps to make this recompute after geocode batches
    void distanceVersion;
    const q = searchTerm.toLowerCase().trim();
    const looksLikeLocation = /\d/.test(q);

    let list = djsRef.current.filter((dj) => {
      // Type filter: keep if dj_type is in activeFilters
      const t = dj.dj_type ? activeFilters.has(dj.dj_type) : true;
      // Search filter: zip search uses geocoding (not text match), so don't
      // text-filter when looksLikeLocation; only when it's a name search
      const s = !q || looksLikeLocation || [dj.name, dj.zip].some((v) => (v || '').toLowerCase().includes(q));
      // Country filter: keep if no country set OR matches active
      const c = !dj.country || dj.country === activeCountry;
      return t && s && c;
    });

    // When searching by zip + we have userLocation, drop DJs whose travel
    // limit can't reach. 10mi grace per vanilla.
    if (userLocation && looksLikeLocation) {
      list = list.filter((dj) => {
        if (!dj.travel_distance) return true;
        if (dj.travel_distance === 'worldwide') return true;
        const max = parseInt(dj.travel_distance, 10);
        if (isNaN(max)) return true;
        return (dj._distance || 0) <= max + 10;
      });
    }

    // Sort
    if (sortMode === 'nearest' && userLocation) {
      list.sort((a, b) => (a._distance ?? 9999) - (b._distance ?? 9999));
    } else {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    return list;
  }, [searchTerm, activeFilters, activeCountry, userLocation, sortMode, distanceVersion]);

  // Close country menu on outside click
  useEffect(() => {
    if (!showCountryMenu) return;
    const handler = () => setShowCountryMenu(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showCountryMenu]);

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <>
      <div className="controls">
        {/* Search row: search box + country flag inside it, with Find Near Me
            button sitting immediately to its right on the same line. The
            previous version had Near Me on a row of its own pushed to the
            right, which Anthony noted should be tighter. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
          <div className="search-wrap" style={{ flex: '1 1 240px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              id="search"
              placeholder="Search by zip or DJ name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <div
              className="country-indicator"
              onClick={(e) => {
                e.stopPropagation();
                setShowCountryMenu((prev) => !prev);
              }}
            >
              <span style={{ fontSize: '1rem' }}>{COUNTRY_FLAGS[activeCountry] || '🌍'}</span>
              {showCountryMenu && (
                <div className="country-menu" onClick={(e) => e.stopPropagation()}>
                  {COUNTRY_NAMES.map((c) => (
                    <div
                      key={c}
                      className={`country-option ${c === activeCountry ? 'selected' : ''}`}
                      onClick={() => {
                        setActiveCountry(c);
                        setShowCountryMenu(false);
                      }}
                    >
                      <span>{COUNTRY_FLAGS[c]}</span>
                      <span>{c}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={findNearMe}
            disabled={nearMeStatus === 'getting' || nearMeStatus === 'geocoding'}
            style={{
              background: nearMeStatus === 'found' ? 'var(--neon-dim)' : 'transparent',
              border: '1px solid var(--neon)',
              color: 'var(--neon)',
              fontFamily: "'Space Mono', monospace",
              fontSize: '.62rem',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              cursor: (nearMeStatus === 'getting' || nearMeStatus === 'geocoding') ? 'wait' : 'pointer',
              padding: '.55rem .85rem',
              borderRadius: '6px',
              transition: 'all .2s',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '.35rem',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {nearMeStatus === 'getting' && 'Getting location…'}
            {nearMeStatus === 'geocoding' && geocodeProgress &&
              `Loading ${geocodeProgress.done}/${geocodeProgress.total}…`}
            {nearMeStatus === 'geocoding' && !geocodeProgress && 'Loading…'}
            {nearMeStatus === 'found' && 'Near Me ✓'}
            {(nearMeStatus === 'idle' || nearMeStatus === 'error') && 'Find DJs Near Me'}
          </button>
        </div>

        <div style={{ width: '100%', height: '1px', background: 'var(--border)', margin: '.5rem 0' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', width: '100%' }}>
          <div className="filter-pills">
            <button
              type="button"
              className={`pill ${activeFilters.has('mobile') ? 'active' : ''}`}
              onClick={() => togglePill('mobile')}
            >
              Mobile DJ {activeFilters.has('mobile') ? '✓' : ''}
            </button>
            <button
              type="button"
              className={`pill pink ${activeFilters.has('club') ? 'active' : ''}`}
              onClick={() => togglePill('club')}
            >
              Club/Bar DJs {activeFilters.has('club') ? '✓' : ''}
            </button>
          </div>

          <div className="view-toggle" style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>

          <span className="count-badge hide-mobile">
            Showing <span>{Math.min(visibleCount, visibleDjs.length)}</span>
            {visibleDjs.length > visibleCount && ` of ${visibleDjs.length}`}
          </span>
        </div>
      </div>

      <div className="main">
        {visibleDjs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">{djsRef.current.length === 0 ? '🎧' : '🔍'}</div>
            <div className="empty-title">
              {djsRef.current.length === 0 ? 'No DJs Listed Yet' : 'No Results'}
            </div>
            <div className="empty-sub">
              {djsRef.current.length === 0
                ? 'Check back soon.'
                : 'Try different keywords or adjust the filters.'}
            </div>
          </div>
        ) : (
          <>
            {viewMode === 'grid' ? (
              <div className="grid">
                {visibleDjs.slice(0, visibleCount).map((dj, i) => (
                  <DjCard key={dj.id} dj={dj} index={i} />
                ))}
              </div>
            ) : (
              <div className="dj-list">
                {visibleDjs.slice(0, visibleCount).map((dj) => (
                  <DjListRow key={dj.id} dj={dj} />
                ))}
              </div>
            )}

            {/* Show More — appears when there are more results than the
                current visibleCount allows. Each click adds 100 more. */}
            {visibleDjs.length > visibleCount && (
              <div style={{ textAlign: 'center', marginTop: '2.5rem', marginBottom: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + 100)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--neon)',
                    color: 'var(--neon)',
                    fontFamily: "'Space Mono', monospace",
                    fontSize: '.7rem',
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
                    padding: '.85rem 1.75rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'background .2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--neon-dim)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  Show More ({visibleDjs.length - visibleCount} more)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─── Card view ────────────────────────────────────────────────────
// Structure mirrors vanilla cardHTML — avatar + type-badge in card-top,
// name/location BELOW. This is what fixes the "avatar hovering over text"
// bug from the previous version: we were rendering name inline with
// avatar in a flex row, which the vanilla CSS doesn't expect.
function DjCard({ dj, index }: { dj: HomeDj; index: number }) {
  const typeClass = dj.dj_type || 'mobile';
  const slug = dj.slug || '';
  const location = [dj.city, dj.state].filter(Boolean).join(', ');

  return (
    <Link
      href={`/${slug}`}
      className={`dj-card ${typeClass}`}
      style={{
        animationDelay: `${index * 0.03}s`,
        cursor: 'pointer',
        textDecoration: 'none',
        color: 'inherit',
        display: 'block',
      }}
    >
      <div className="card-glow" />
      <div className="card-top">
        <div className="avatar" style={{ background: avatarGradient(dj.dj_type) }}>
          {dj.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dj.avatar_url}
              alt={dj.name || 'DJ avatar'}
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block' }}
            />
          ) : (
            initials(dj.name)
          )}
        </div>
        {dj.dj_type && (
          <div className="type-badge">
            {dj.dj_type === 'club' ? '🎧 Club/Bar' : '🎵 Mobile'}
          </div>
        )}
      </div>
      <div className="dj-name">{dj.name || 'Unknown DJ'}</div>
      {location && (
        <div className="dj-city">
          📍 {location}
          {dj._distance && dj._distance < 9999 && (
            <span style={{ color: 'var(--neon)', fontWeight: 500 }}>
              {' '}({Math.round(dj._distance)} mi away)
            </span>
          )}
        </div>
      )}
      <div className="card-footer">{dj.rate && <div className="rate">{dj.rate}</div>}</div>
    </Link>
  );
}

// ─── List view row ────────────────────────────────────────────────
function DjListRow({ dj }: { dj: HomeDj }) {
  const typeLabel = dj.dj_type === 'club' ? '🎧 Club/Bar' : dj.dj_type === 'mobile' ? '🎵 Mobile' : '—';
  const typeClass = dj.dj_type || 'none';
  const location = [dj.city, dj.state].filter(Boolean).join(', ') || '—';
  const slug = dj.slug || '';

  // Booking enabled: only club DJs with booking_settings.booking_enabled = true
  let bookingEnabled = false;
  if (dj.dj_type === 'club' && dj.booking_settings) {
    try {
      const bs = typeof dj.booking_settings === 'string'
        ? JSON.parse(dj.booking_settings)
        : dj.booking_settings;
      bookingEnabled = !!(bs && bs.booking_enabled);
    } catch {
      // ignore parse errors
    }
  }

  return (
    <Link
      href={`/${slug}`}
      className={`dj-list-row ${typeClass}`}
      style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}
    >
      <div className="dll-avatar" style={{ background: avatarGradient(dj.dj_type) }}>
        {dj.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dj.avatar_url}
            alt={dj.name || ''}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block' }}
          />
        ) : (
          initials(dj.name)
        )}
      </div>
      <div className="dll-name-wrap">
        <div className="dll-name">{dj.name || 'Unknown DJ'}</div>
        <div className="dll-location">
          📍 {location}
          {dj._distance && dj._distance < 9999 && (
            <span style={{ color: 'var(--neon)' }}> ({Math.round(dj._distance)}mi)</span>
          )}
        </div>
      </div>
      <span className={`dll-type ${typeClass}`}>{typeLabel}</span>
      <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
        {bookingEnabled && (
          <span
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: '.6rem',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              padding: '.3rem .5rem',
              borderRadius: '3px',
              background: 'var(--neon)',
              color: 'var(--black)',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            Book
          </span>
        )}
        <span
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: '.6rem',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            padding: '.3rem .5rem',
            borderRadius: '3px',
            border: '1px solid var(--neon)',
            color: 'var(--neon)',
            background: 'transparent',
            whiteSpace: 'nowrap',
          }}
        >
          Contact
        </span>
      </div>
    </Link>
  );
}
