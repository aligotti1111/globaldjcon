// Embed builders for the Mixes and Video tabs.
// Faithful ports of vanilla buildMediaEmbed (mix_url_*) and buildYouTubeEmbed
// (video_url_*) from dj-profile.html lines 2087-2125.

export interface EmbedSpec {
  kind: 'soundcloud' | 'mixcloud' | 'youtube';
  src: string;
  height: number; // px
}

// Build a music-platform embed (for Mixes tab — SoundCloud or Mixcloud).
// Returns null if the URL doesn't match a recognized platform.
export function buildMixEmbed(url: string | null | undefined): EmbedSpec | null {
  if (!url) return null;

  // SoundCloud
  if (url.includes('soundcloud.com')) {
    const encoded = encodeURIComponent(url);
    return {
      kind: 'soundcloud',
      src: `https://w.soundcloud.com/player/?url=${encoded}&color=%2300f5c4&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`,
      height: 166,
    };
  }

  // Mixcloud — vanilla strips the host then re-encodes the path
  if (url.includes('mixcloud.com')) {
    const path = url.replace('https://www.mixcloud.com', '').replace('https://mixcloud.com', '');
    return {
      kind: 'mixcloud',
      src: `https://player.mixcloud.com/widget/iframe/?hide_cover=1&mini=1&feed=${encodeURIComponent(path)}&light=1`,
      height: 120,
    };
  }

  return null;
}

// Build a YouTube embed (for Video tab).
// Returns null if the URL doesn't have a parseable video ID.
export function buildVideoEmbed(url: string | null | undefined): EmbedSpec | null {
  if (!url) return null;

  let videoId = '';
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      videoId = u.pathname.slice(1);
    } else {
      videoId = u.searchParams.get('v') || '';
    }
  } catch {
    return null;
  }
  if (!videoId) return null;

  return {
    kind: 'youtube',
    src: `https://www.youtube.com/embed/${videoId}`,
    height: 0, // YouTube uses padding-top trick — the wrapper handles aspect ratio
  };
}
