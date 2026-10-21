'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { thumbUrl, validateImageFile, MAX_IMAGE_BYTES } from '../profilePhotoUtils';
import { saveProfile, profileUploadFolder } from '../profileSave';
import { canCreateAlbums, albumLimitForTier, newAlbumId, type Album } from '@/lib/albums';

// ─────────────────────────────────────────────────────────────────────────
// PhotoManagerModal — owner-only popup that shows all 4 gallery slots
// as boxes in a 2x2 grid. Empty boxes are click-to-upload, filled boxes
// show the image with a remove ✕. Each slot operates independently and
// writes directly to public.users.gallery_img_${slot} as it changes.
// Mirrors the look of update-dj-profile/PhotosTab but lives on the
// public profile so the DJ never has to leave.
//
// On close we reload (?tab=images) so the underlying photo grid in
// the tab reflects whatever was added/removed.
// ─────────────────────────────────────────────────────────────────────────
export function PhotoManagerModal({
  userId,
  photos,
  albums = [],
  tier = 0,
  cap,
  isPaid,
  onClose,
}: {
  userId: string;
  photos: string[];
  albums?: Album[];
  tier?: number;
  cap: number;
  isPaid: boolean;
  onClose: () => void;
}) {
  // Array-based gallery. Photos persist to public.users.gallery_photos
  // (a jsonb array). Upload appends up to `cap`; remove pulls from the array.
  const [list, setList] = useState<string[]>(photos);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const atCap = list.length >= cap;

  // ── Albums (Premium Pro + Enterprise) ──────────────────────────────
  const canAlbums = canCreateAlbums(tier);
  const albumLimit = albumLimitForTier(tier);
  const [albumList, setAlbumList] = useState<Album[]>(albums);
  // Which album's photos the manager grid is filtered to (null = all).
  const [viewAlbumId, setViewAlbumId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const viewAlbum = viewAlbumId ? albumList.find((a) => a.id === viewAlbumId) || null : null;
  // Photos shown in the grid, newest first. Filtered to the album when viewing.
  const shown = (viewAlbum ? list.filter((u) => viewAlbum.photos.includes(u)) : list).slice().reverse();

  async function persist(next: string[]) {
    await saveProfile(userId, { gallery_photos: next });
  }
  async function persistAlbums(next: Album[]) {
    setAlbumList(next);
    await saveProfile(userId, { gallery_albums: next });
  }

  function toggleSelect(url: string) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(url)) s.delete(url); else s.add(url);
      return s;
    });
  }

  async function createAlbum() {
    const name = newName.trim();
    if (!name) return;
    if (albumList.length >= albumLimit) { setError(`You've reached your album limit (${albumLimit}).`); return; }
    const members = Array.from(selected);
    const album: Album = { id: newAlbumId(), name, cover: members[members.length - 1] || null, photos: members };
    setBusy(true);
    try {
      await persistAlbums([...albumList, album]);
      setNewName(''); setCreating(false); setSelected(new Set()); setSelectMode(false);
    } catch { setError('Could not create album.'); } finally { setBusy(false); }
  }

  async function assignSelectedTo(albumId: string) {
    const urls = Array.from(selected);
    if (!urls.length) return;
    setBusy(true);
    try {
      const next = albumList.map((a) => {
        if (a.id !== albumId) return a;
        const merged = [...a.photos, ...urls.filter((u) => !a.photos.includes(u))];
        return { ...a, photos: merged, cover: a.cover || merged[merged.length - 1] || null };
      });
      await persistAlbums(next);
      setSelected(new Set()); setSelectMode(false); setAssignOpen(false);
    } catch { setError('Could not add to album.'); } finally { setBusy(false); }
  }

  async function removeSelectedFromAlbum(albumId: string) {
    const urls = new Set(selected);
    setBusy(true);
    try {
      const next = albumList.map((a) => {
        if (a.id !== albumId) return a;
        const photos = a.photos.filter((u) => !urls.has(u));
        return { ...a, photos, cover: photos.includes(a.cover || '') ? a.cover : photos[photos.length - 1] || null };
      });
      await persistAlbums(next);
      setSelected(new Set());
    } catch { setError('Could not update album.'); } finally { setBusy(false); }
  }

  async function deleteAlbum(albumId: string) {
    setBusy(true);
    try {
      await persistAlbums(albumList.filter((a) => a.id !== albumId));
      if (viewAlbumId === albumId) setViewAlbumId(null);
    } catch { setError('Could not delete album.'); } finally { setBusy(false); }
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setError(null);
    const room = cap - list.length;
    if (room <= 0) return;
    const toAdd = files.slice(0, room);
    setBusy(true);
    try {
      const supabase = createClient();
      const uploaded: string[] = [];
      for (const file of toAdd) {
        const valErr = await validateImageFile(file);
        if (valErr) { setError(valErr); continue; }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
        const id = rand.replace(/[^a-z0-9]/gi, '');
        const path = `${profileUploadFolder(userId)}/gallery_${id}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) { setError(upErr.message); continue; }
        const { data } = supabase.storage.from('avatars').getPublicUrl(path);
        uploaded.push(`${data.publicUrl}?t=${Date.now()}`);
      }
      if (uploaded.length) {
        const next = [...list, ...uploaded];
        await persist(next);
        setList(next);
        // Uploading while viewing an album drops the new photos into it too
        // (bulk upload from device straight into the album).
        if (viewAlbumId) {
          const nextAlbums = albumList.map((a) =>
            a.id === viewAlbumId
              ? { ...a, photos: [...a.photos, ...uploaded], cover: a.cover || uploaded[uploaded.length - 1] }
              : a,
          );
          await persistAlbums(nextAlbums);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function removeUrl(url: string) {
    if (busy) return;
    if (typeof window !== 'undefined' && !window.confirm('Delete this photo? This removes it from your gallery and any albums it’s in.')) return;
    setBusy(true);
    setError(null);
    try {
      const next = list.filter((u) => u !== url);
      await persist(next);
      setList(next);
      // Removing a photo from the gallery also drops it from any album it was
      // in (the gallery is the source of truth).
      if (albumList.some((a) => a.photos.includes(url))) {
        const nextAlbums = albumList.map((a) => {
          const photos = a.photos.filter((u) => u !== url);
          return { ...a, photos, cover: a.cover === url ? photos[photos.length - 1] || null : a.cover };
        });
        await persistAlbums(nextAlbums);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg-card, #1a1a2e)', border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: 'var(--white, #fff)', letterSpacing: '.04em' }}>
            Manage Photos
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--muted, #888)', fontSize: '1.4rem', cursor: 'pointer', padding: '.25rem .5rem' }}>✕</button>
        </div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.7rem', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted, #888)', marginBottom: '1rem' }}>
          {list.length} of {cap} photos
        </div>

        {/* Album controls (Premium Pro + Enterprise). Chips filter the grid to
            an album; Select turns on multi-select to add/remove photos in bulk.
            Lower tiers see an upgrade line instead. */}
        {canAlbums ? (
          <div style={{ marginBottom: '.9rem' }}>
            <div style={{ display: 'flex', gap: '.4rem', overflowX: 'auto', paddingBottom: '.4rem' }}>
              <button type="button" onClick={() => { setViewAlbumId(null); setSelected(new Set()); }} style={{ flexShrink: 0, fontSize: '.68rem', padding: '.3rem .7rem', borderRadius: 100, border: `1px solid ${!viewAlbumId ? 'var(--neon)' : 'var(--border,rgba(255,255,255,.2))'}`, background: !viewAlbumId ? 'var(--neon)' : 'transparent', color: !viewAlbumId ? '#04121a' : 'var(--muted,#aaa)', cursor: 'pointer', fontWeight: 600 }}>All photos</button>
              {albumList.map((a) => (
                <button key={a.id} type="button" onClick={() => { setViewAlbumId(a.id); setSelected(new Set()); }} style={{ flexShrink: 0, fontSize: '.68rem', padding: '.3rem .7rem', borderRadius: 100, border: `1px solid ${viewAlbumId === a.id ? 'var(--neon)' : 'var(--border,rgba(255,255,255,.2))'}`, background: viewAlbumId === a.id ? 'var(--neon)' : 'transparent', color: viewAlbumId === a.id ? '#04121a' : 'var(--muted,#aaa)', cursor: 'pointer', fontWeight: 600 }}>{a.name} · {a.photos.length}</button>
              ))}
              {/* Always-visible create-album entry point (no Select needed). */}
              {albumList.length < albumLimit && (
                creating ? (
                  <span style={{ flexShrink: 0, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Album name" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') createAlbum(); }} style={{ fontSize: '.7rem', padding: '.3rem .5rem', borderRadius: 100, border: '1px solid var(--neon)', background: '#0c0c11', color: '#fff', width: 120 }} />
                    <button type="button" disabled={busy || !newName.trim()} onClick={createAlbum} style={{ fontSize: '.66rem', padding: '.3rem .6rem', borderRadius: 100, border: 'none', background: 'var(--neon)', color: '#04121a', cursor: 'pointer', fontWeight: 700 }}>Add</button>
                    <button type="button" onClick={() => { setCreating(false); setNewName(''); }} style={{ fontSize: '.66rem', padding: '.3rem .5rem', borderRadius: 100, border: '1px solid var(--border,rgba(255,255,255,.2))', background: 'transparent', color: 'var(--muted,#aaa)', cursor: 'pointer' }}>✕</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setCreating(true)} style={{ flexShrink: 0, fontSize: '.68rem', padding: '.3rem .7rem', borderRadius: 100, border: '1px dashed var(--neon)', background: 'transparent', color: 'var(--neon)', cursor: 'pointer', fontWeight: 600 }}>+ New album</button>
                )
              )}
            </div>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '.5rem' }}>
              <button type="button" onClick={() => { setSelectMode((m) => !m); setSelected(new Set()); setAssignOpen(false); }} style={{ fontSize: '.68rem', padding: '.35rem .8rem', borderRadius: 6, border: '1px solid var(--neon)', background: selectMode ? 'var(--neon)' : 'transparent', color: selectMode ? '#04121a' : 'var(--neon)', cursor: 'pointer' }}>{selectMode ? 'Cancel' : 'Select'}</button>
              {selectMode && (
                <>
                  <span style={{ fontSize: '.7rem', color: 'var(--muted,#888)' }}>{selected.size} selected</span>
                  <button type="button" disabled={!selected.size || busy} onClick={() => setAssignOpen((o) => !o)} style={{ fontSize: '.68rem', padding: '.35rem .8rem', borderRadius: 6, border: '1px solid var(--border,rgba(255,255,255,.25))', background: 'transparent', color: 'var(--white,#fff)', cursor: selected.size ? 'pointer' : 'not-allowed', opacity: selected.size ? 1 : 0.5 }}>Add to album ▾</button>
                  {viewAlbum && (
                    <button type="button" disabled={!selected.size || busy} onClick={() => removeSelectedFromAlbum(viewAlbum.id)} style={{ fontSize: '.68rem', padding: '.35rem .8rem', borderRadius: 6, border: '1px solid #ff5f5f', background: 'transparent', color: '#ff5f5f', cursor: 'pointer', opacity: selected.size ? 1 : 0.5 }}>Remove from {viewAlbum.name}</button>
                  )}
                </>
              )}
              {selectMode && assignOpen && (
                <div style={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: '.4rem', padding: '.5rem', border: '1px solid var(--border,rgba(255,255,255,.15))', borderRadius: 8 }}>
                  {albumList.map((a) => (
                    <button key={a.id} type="button" disabled={busy} onClick={() => assignSelectedTo(a.id)} style={{ fontSize: '.68rem', padding: '.3rem .7rem', borderRadius: 6, border: '1px solid var(--border,rgba(255,255,255,.2))', background: 'transparent', color: 'var(--white,#fff)', cursor: 'pointer' }}>{a.name}</button>
                  ))}
                  {albumList.length < albumLimit ? (
                    creating ? (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Album name" autoFocus style={{ fontSize: '.7rem', padding: '.3rem .5rem', borderRadius: 6, border: '1px solid var(--border,rgba(255,255,255,.25))', background: '#0c0c11', color: '#fff' }} />
                        <button type="button" disabled={busy || !newName.trim()} onClick={createAlbum} style={{ fontSize: '.68rem', padding: '.3rem .7rem', borderRadius: 6, border: 'none', background: 'var(--neon)', color: '#04121a', cursor: 'pointer', fontWeight: 700 }}>Create</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setCreating(true)} style={{ fontSize: '.68rem', padding: '.3rem .7rem', borderRadius: 6, border: '1px dashed var(--neon)', background: 'transparent', color: 'var(--neon)', cursor: 'pointer' }}>+ New album</button>
                    )
                  ) : (
                    <span style={{ fontSize: '.66rem', color: 'var(--muted,#888)' }}>Album limit reached ({albumLimit})</span>
                  )}
                </div>
              )}
              {!selectMode && viewAlbum && (
                <button type="button" onClick={() => deleteAlbum(viewAlbum.id)} style={{ fontSize: '.66rem', padding: '.35rem .8rem', borderRadius: 6, border: '1px solid #ff5f5f', background: 'transparent', color: '#ff5f5f', cursor: 'pointer', marginLeft: 'auto' }}>Delete album</button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: '.9rem', padding: '.6rem .8rem', border: '1px solid var(--border,rgba(255,255,255,.15))', borderRadius: 8, fontSize: '.76rem', color: 'var(--muted,#aaa)' }}>
            Organize photos into albums with <a href="/subscribe" style={{ color: 'var(--neon)', fontWeight: 700 }}>Premium Pro</a>.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.6rem' }}>
          {shown.map((url, idx) => {
            const isSel = selected.has(url);
            return (
            <div key={`${url}-${idx}`} onClick={() => { if (selectMode) toggleSelect(url); }} style={{ position: 'relative', aspectRatio: '1 / 1', background: '#000', border: `2px solid ${isSel ? 'var(--neon)' : 'var(--border, rgba(255,255,255,0.15))'}`, borderRadius: 8, overflow: 'hidden', cursor: selectMode ? 'pointer' : 'default' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbUrl(url, 400)} alt={`Photo ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: selectMode && !isSel ? 0.65 : 1 }} />
              {selectMode && (
                <span style={{ position: 'absolute', top: 4, left: 4, width: 20, height: 20, borderRadius: '50%', background: isSel ? 'var(--neon)' : 'rgba(0,0,0,.55)', color: '#04121a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{isSel ? '✓' : ''}</span>
              )}
              {!selectMode && (
                <button
                  type="button"
                  onClick={() => removeUrl(url)}
                  aria-label="Remove photo"
                  style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 13, cursor: 'pointer', lineHeight: 1 }}
                >✕</button>
              )}
            </div>
            );
          })}

          {!atCap && !selectMode && (
            <div
              onClick={() => { if (!busy) inputRef.current?.click(); }}
              style={{ aspectRatio: '1 / 1', background: 'rgba(0,245,196,.05)', border: '2px dashed var(--neon)', borderRadius: 8, cursor: busy ? 'wait' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--neon)', opacity: busy ? 0.6 : 1 }}
            >
              <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>+</span>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '.6rem', letterSpacing: '.05em', marginTop: 4 }}>ADD</span>
            </div>
          )}
        </div>

        <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onFiles} />

        {atCap && !isPaid && (
          <div style={{ marginTop: '1rem', padding: '.75rem .9rem', border: '1px solid var(--neon)', borderRadius: 8, background: 'rgba(0,245,196,.06)', fontFamily: 'DM Sans, sans-serif', fontSize: '.82rem', color: 'var(--white,#fff)' }}>
            You&apos;ve reached the free limit of {cap} photos.{' '}
            <a href="/subscribe" style={{ color: 'var(--neon)', fontWeight: 700 }}>Upgrade</a> to add up to 50.
          </div>
        )}

        {error && (
          <div style={{ marginTop: '.75rem', color: '#ff5f5f', fontSize: '.78rem', fontFamily: 'DM Sans, sans-serif' }}>{error}</div>
        )}

        <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '.6rem 1.4rem', background: 'var(--neon)', border: 'none', borderRadius: 6, color: '#000', fontFamily: "'Space Mono', monospace", fontSize: '.75rem', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CreateAlbumModal — the "New album" flow. Focused on CREATING one album:
// name it, then fill it either by uploading from the device or picking from
// the DJ's existing gallery photos. It intentionally has NO delete-photo
// capability — it only adds; managing/removing photos lives in the photo
// manager. Uploaded photos also land in the main gallery (source of truth).
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// AddPhotosModal — the lightweight "+ Add" flow. Just a Choose-photos button
// and a Save button: pick files (they preview), then Save uploads them and
// appends to the gallery. No delete/album/select clutter — that all lives in
// the full Manage Photos manager.
// ─────────────────────────────────────────────────────────────────────────
export function AddPhotosModal({
  userId,
  currentCount,
  cap,
  onClose,
}: {
  userId: string;
  currentCount: number;
  cap: number;
  onClose: () => void;
}) {
  const [staged, setStaged] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const room = cap - currentCount - staged.length;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setError(null);
    const avail = cap - currentCount - staged.length;
    if (avail <= 0) { setError(`Photo limit reached (${cap}).`); return; }
    const toAdd = files.slice(0, avail).map((file) => ({ file, url: URL.createObjectURL(file) }));
    if (files.length > avail) setError(`Only ${avail} more photo${avail === 1 ? '' : 's'} allowed — extras were skipped.`);
    setStaged((prev) => [...prev, ...toAdd]);
  }

  function removeStaged(idx: number) {
    setStaged((prev) => {
      const removed = prev[idx];
      if (removed) URL.revokeObjectURL(removed.url);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function save() {
    if (!staged.length) { onClose(); return; }
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const uploaded: string[] = [];
      for (const { file } of staged) {
        const valErr = await validateImageFile(file);
        if (valErr) { setError(valErr); continue; }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const rand = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
        const id = rand.replace(/[^a-z0-9]/gi, '');
        const path = `${profileUploadFolder(userId)}/gallery_${id}.${ext}`;
        const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) { setError(upErr.message); continue; }
        const { data } = supabase.storage.from('avatars').getPublicUrl(path);
        uploaded.push(`${data.publicUrl}?t=${Date.now()}`);
      }
      if (!uploaded.length) { setBusy(false); return; }
      // Append to the gallery (source of truth). Re-read first so we don't
      // clobber photos added elsewhere; the owner passes the full next array.
      const { data: row } = await supabase.from('users').select('gallery_photos').eq('id', userId).single();
      const rowPhotos = (row as unknown as { gallery_photos?: string[] } | null)?.gallery_photos;
      const existing: string[] = Array.isArray(rowPhotos) ? rowPhotos : [];
      await saveProfile(userId, { gallery_photos: [...existing, ...uploaded] });
      staged.forEach((s) => URL.revokeObjectURL(s.url));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
      setBusy(false);
    }
  }

  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card, #14141b)', border: '1px solid var(--border, rgba(255,255,255,0.12))', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: 'var(--white, #fff)', letterSpacing: '.04em' }}>Add photos</div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--muted, #888)', fontSize: '1.4rem', cursor: 'pointer', padding: '.25rem .5rem' }}>✕</button>
        </div>

        <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onPick} />
        <button type="button" disabled={busy || room <= 0} onClick={() => inputRef.current?.click()} style={{ width: '100%', padding: '.7rem 1rem', borderRadius: 8, border: '1.5px solid var(--neon)', background: 'rgba(0,245,196,.06)', color: 'var(--neon)', fontWeight: 700, fontSize: '.85rem', cursor: room <= 0 ? 'not-allowed' : 'pointer', opacity: room <= 0 ? 0.5 : 1 }}>
          {staged.length ? 'Choose more photos' : 'Choose photos'}
        </button>
        <div style={{ fontSize: '.7rem', color: 'var(--muted,#888)', marginTop: '.4rem', textAlign: 'center' }}>{currentCount + staged.length} of {cap} used · max {Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB per photo</div>

        {staged.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.5rem', marginTop: '1rem' }}>
            {staged.map((s, i) => (
              <div key={i} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border,rgba(255,255,255,.15))' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {!busy && (
                  <button type="button" onClick={() => removeStaged(i)} aria-label="Remove" style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.6)', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>✕</button>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <div style={{ color: '#ff5f5f', fontSize: '.78rem', marginTop: '.75rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.6rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ padding: '.6rem 1.2rem', background: 'transparent', border: '1px solid var(--border,rgba(255,255,255,.25))', borderRadius: 6, color: 'var(--white,#fff)', fontSize: '.78rem', cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={save} disabled={busy || staged.length === 0} style={{ padding: '.6rem 1.4rem', background: 'var(--neon)', border: 'none', borderRadius: 6, color: '#04121a', fontWeight: 700, fontSize: '.78rem', letterSpacing: '.04em', textTransform: 'uppercase', cursor: busy || !staged.length ? 'not-allowed' : 'pointer', opacity: busy || !staged.length ? 0.6 : 1 }}>{busy ? 'Saving…' : `Save${staged.length ? ` (${staged.length})` : ''}`}</button>
        </div>
      </div>
    </div>
  );
}

export function CreateAlbumModal({
  userId,
  photos,
  albums,
  cap,
  editAlbum = null,
  onClose,
}: {
  userId: string;
  photos: string[];
  albums: Album[];
  cap: number;
  editAlbum?: Album | null; // when set, the modal edits this album
  onClose: () => void;
}) {
  const isEdit = !!editAlbum;
  const [name, setName] = useState(editAlbum?.name ?? '');
  const [gallery, setGallery] = useState<string[]>(photos); // grows on upload
  const [added, setAdded] = useState<string[]>([]); // uploaded THIS session
  const [chosen, setChosen] = useState<Set<string>>(new Set(editAlbum?.photos ?? []));
  // Which selected photo is the album cover/thumbnail (edit mode).
  const [coverSel, setCoverSel] = useState<string | null>(editAlbum?.cover ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Split the picker: photos uploaded from the device this session vs. the
  // DJ's pre-existing gallery. Newest first in each group.
  const justAdded = added.slice().reverse();
  const addedSet = new Set(added);
  const existing = photos.filter((u) => !addedSet.has(u)).slice().reverse();

  function toggle(url: string) {
    setChosen((prev) => {
      const s = new Set(prev);
      if (s.has(url)) s.delete(url); else s.add(url);
      return s;
    });
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setError(null);
    const room = cap - gallery.length;
    if (room <= 0) { setError(`Photo limit reached (${cap}).`); return; }
    const toAdd = files.slice(0, room);
    setBusy(true);
    try {
      const supabase = createClient();
      const uploaded: string[] = [];
      for (const file of toAdd) {
        const valErr = await validateImageFile(file);
        if (valErr) { setError(valErr); continue; }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const rand = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
        const id = rand.replace(/[^a-z0-9]/gi, '');
        const path = `${profileUploadFolder(userId)}/gallery_${id}.${ext}`;
        const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) { setError(upErr.message); continue; }
        const { data } = supabase.storage.from('avatars').getPublicUrl(path);
        uploaded.push(`${data.publicUrl}?t=${Date.now()}`);
      }
      if (uploaded.length) {
        const nextGallery = [...gallery, ...uploaded];
        // Persist the grown gallery immediately (uploads belong to it).
        await saveProfile(userId, { gallery_photos: nextGallery });
        setGallery(nextGallery);
        setAdded((prev) => [...prev, ...uploaded]);
        // Newly uploaded photos are auto-selected for the album.
        setChosen((prev) => { const s = new Set(prev); uploaded.forEach((u) => s.add(u)); return s; });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const nm = name.trim();
    if (!nm) { setError('Name your album.'); return; }
    if (chosen.size === 0) { setError('Add at least one photo.'); return; }
    // Members in gallery order (oldest→newest) so album order matches feed.
    const members = gallery.filter((u) => chosen.has(u));
    setBusy(true);
    try {
      let nextAlbums: Album[];
      if (isEdit && editAlbum) {
        // Use the owner-picked cover if it's still a member; otherwise keep the
        // existing cover if valid, else fall back to the newest member.
        const cover = coverSel && chosen.has(coverSel)
          ? coverSel
          : (editAlbum.cover && chosen.has(editAlbum.cover) ? editAlbum.cover : members[members.length - 1] || null);
        nextAlbums = albums.map((a) => (a.id === editAlbum.id ? { ...a, name: nm, photos: members, cover } : a));
      } else {
        const album: Album = { id: newAlbumId(), name: nm, cover: members[members.length - 1] || null, photos: members };
        nextAlbums = [...albums, album];
      }
      await saveProfile(userId, { gallery_albums: nextAlbums });
      setSaved(true);
      onClose();
    } catch {
      setError(isEdit ? 'Could not save the album.' : 'Could not create the album.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAlbum() {
    if (!editAlbum) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete the album "${editAlbum.name}"? Your photos stay in the gallery — only the album is removed.`)) return;
    setBusy(true);
    try {
      await saveProfile(userId, { gallery_albums: albums.filter((a) => a.id !== editAlbum.id) });
      setSaved(true);
      onClose();
    } catch {
      setError('Could not delete the album.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card, #1a1a2e)', border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.9rem' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: 'var(--white, #fff)', letterSpacing: '.04em' }}>{isEdit ? 'Edit album' : 'New album'}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--muted, #888)', fontSize: '1.4rem', cursor: 'pointer', padding: '.25rem .5rem' }}>✕</button>
        </div>

        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Album name (e.g. Weddings)" autoFocus style={{ width: '100%', padding: '.6rem .8rem', borderRadius: 8, border: '1px solid var(--border,rgba(255,255,255,.25))', background: '#0c0c11', color: '#fff', fontSize: '.9rem', marginBottom: '1rem' }} />

        <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} style={{ padding: '.55rem 1rem', borderRadius: 8, border: '1px solid var(--neon)', background: 'var(--neon)', color: '#04121a', fontWeight: 700, fontSize: '.78rem', cursor: 'pointer' }}>Upload from device</button>
          <span style={{ fontSize: '.72rem', color: 'var(--muted,#888)' }}>{chosen.size} selected</span>
        </div>
        <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onFiles} />

        {(() => {
          const tile = (url: string, idx: number) => {
            const isSel = chosen.has(url);
            const isCover = isEdit && coverSel === url;
            return (
              <div key={`${url}-${idx}`} onClick={() => toggle(url)} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: `2px solid ${isCover ? '#ffd24a' : isSel ? 'var(--neon)' : 'var(--border,rgba(255,255,255,.15))'}`, cursor: 'pointer' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbUrl(url, 300)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: isSel ? 1 : 0.7 }} />
                <span style={{ position: 'absolute', top: 3, left: 3, width: 18, height: 18, borderRadius: '50%', background: isSel ? 'var(--neon)' : 'rgba(0,0,0,.55)', color: '#04121a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{isSel ? '✓' : ''}</span>
                {/* Edit mode: set as album cover. Only for selected photos. */}
                {isEdit && isSel && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setCoverSel(url); }}
                    title={isCover ? 'Album cover' : 'Set as cover'}
                    aria-label={isCover ? 'Album cover' : 'Set as cover'}
                    style={{ position: 'absolute', top: 3, right: 3, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.6)', color: isCover ? '#ffd24a' : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill={isCover ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                  </button>
                )}
                {isCover && (
                  <span style={{ position: 'absolute', bottom: 3, left: 3, right: 3, textAlign: 'center', fontSize: '.55rem', letterSpacing: '.05em', textTransform: 'uppercase', color: '#ffd24a', background: 'rgba(0,0,0,.55)', borderRadius: 4, padding: '1px 0' }}>Cover</span>
                )}
              </div>
            );
          };
          const heading = (t: string) => (
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '.66rem', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted,#888)', margin: '0 0 .6rem' }}>{t}</div>
          );
          return (
            <>
              {justAdded.length > 0 && (
                <>
                  {heading(`Just added · ${justAdded.length}`)}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.5rem', marginBottom: '1rem' }}>
                    {justAdded.map((u, i) => tile(u, i))}
                  </div>
                </>
              )}
              {heading('Or choose from your photos')}
              {existing.length === 0 ? (
                <div style={{ fontSize: '.78rem', color: 'var(--muted,#888)', marginBottom: '1rem' }}>{justAdded.length ? 'That’s all your existing photos.' : 'No photos yet — upload some above.'}</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.5rem', marginBottom: '1rem' }}>
                  {existing.map((u, i) => tile(u, i))}
                </div>
              )}
            </>
          );
        })()}

        {error && <div style={{ color: '#ff5f5f', fontSize: '.78rem', marginBottom: '.75rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '.6rem' }}>
          {isEdit && (
            <button type="button" disabled={busy} onClick={deleteAlbum} style={{ marginRight: 'auto', padding: '.6rem 1rem', background: 'transparent', border: '1px solid #ff5f5f', borderRadius: 6, color: '#ff5f5f', fontSize: '.75rem', cursor: 'pointer' }}>Delete album</button>
          )}
          <button type="button" onClick={onClose} style={{ padding: '.6rem 1.2rem', background: 'transparent', border: '1px solid var(--border,rgba(255,255,255,.25))', borderRadius: 6, color: 'var(--white,#fff)', fontSize: '.78rem', cursor: 'pointer' }}>Cancel</button>
          <button type="button" disabled={busy || saved} onClick={save} style={{ padding: '.6rem 1.4rem', background: 'var(--neon)', border: 'none', borderRadius: 6, color: '#04121a', fontFamily: "'Space Mono', monospace", fontSize: '.75rem', letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create album'}</button>
        </div>
      </div>
    </div>
  );
}
