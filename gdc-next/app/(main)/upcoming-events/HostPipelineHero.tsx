'use client';

// HostPipelineHero — the read-only "Booking progress" bar at the top of a
// host's expanded event card. Same connected-node look as the DJ-side
// PipelineHero, but with NO menus or actions — the host is only viewing where
// their booking is. Reuses the DJ page's hero CSS so the two match exactly.

import heroStyles from '../upcoming-bookings/upcomingBookings.module.css';
import type { HostStage } from '@/lib/hostPipeline';

export default function HostPipelineHero({ stages }: { stages: HostStage[] }) {
  if (!stages || stages.length === 0) return null;

  const total = stages.length;
  const doneCount = stages.filter((s) => s.done).length;
  const stepNum = Math.min(doneCount + 1, total);
  // First not-done stage is "now" (amber); everything before it is done.
  const currentKey = stages.find((s) => !s.done)?.key ?? null;

  return (
    <div className={heroStyles.heroWrap}>
      <div className={heroStyles.heroHead}>
        <span className={heroStyles.heroTitle}><span className={heroStyles.heroBar} />Booking progress</span>
        <span className={heroStyles.heroStep}>Step {stepNum} of {total}</span>
      </div>
      <div className={heroStyles.heroPipe}>
        {stages.map((st, i) => {
          const done = st.done;
          const isNow = st.key === currentKey;
          const capColor = done ? 'var(--neon,#22e3ad)' : isNow ? 'var(--amber,#eaa94a)' : '#7d7d92';
          const nodeCls = `${heroStyles.heroNode}${done ? ' ' + heroStyles.heroNodeDone : ''}${isNow ? ' ' + heroStyles.heroNodeNow : ''}`;
          const cap = done ? 'Done' : isNow ? 'In progress' : 'Upcoming';
          return (
            <div key={st.key} className={heroStyles.heroStepCell}>
              <div className={heroStyles.heroConn}>
                <span className={nodeCls}>
                  {done && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="#06231b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </span>
                {i < total - 1 && <span className={`${heroStyles.heroLine}${done ? ' ' + heroStyles.heroLineDone : ''}`} />}
              </div>
              {/* View-only: a plain span, never a button — the host can't act. */}
              <span className={heroStyles.heroName} style={{ color: isNow ? 'var(--amber,#eaa94a)' : undefined }}>{st.label}</span>
              <span className={heroStyles.heroCap} style={{ color: capColor }}>{cap}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
