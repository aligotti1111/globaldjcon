'use client';

// Marketing homepage (globaldjconnect.com/). Renders inside the (main)
// layout so it inherits the real Header/MobileMenu/Footer. CSS scoped under
// .gdc-landing. DJ directory is at /djs.

import { useEffect } from 'react';
import { Bebas_Neue, DM_Sans, Space_Mono } from 'next/font/google';

// Self-host the marketing fonts via next/font instead of a runtime @import of
// Google Fonts. The old @import lived INSIDE the injected <style> string, so the
// browser didn't even discover the fonts until the client JS ran and inserted
// that style — leaving the Bebas Neue hero headings invisible on first paint
// (the "black homepage until it loads" report). next/font preloads them from our
// own origin and exposes each as a CSS variable, wired into --disp/--body/--mono
// below. `display: swap` shows fallback text immediately, then swaps.
const fBebas = Bebas_Neue({ weight: '400', subsets: ['latin'], display: 'swap', variable: '--f-bebas' });
const fDmSans = DM_Sans({ weight: ['400', '500', '600', '700'], subsets: ['latin'], display: 'swap', variable: '--f-dmsans' });
const fSpaceMono = Space_Mono({ weight: ['400', '700'], subsets: ['latin'], display: 'swap', variable: '--f-mono' });

const LANDING_CSS = String.raw`
.gdc-landing{
    --bg:#000; --card:#0c0c11; --card-2:#111118; --ink:#fff; --muted:#8b8b96; --faint:#5c5c68;
    --neon:#00f5c4; --amber:#f5e642; --line:rgba(255,255,255,.08); --line-2:rgba(255,255,255,.15);
    --mono:var(--f-mono),'Space Mono',monospace; --disp:var(--f-bebas),'Bebas Neue',sans-serif; --body:var(--f-dmsans),'DM Sans',sans-serif;
  }
.gdc-landing *, .gdc-landing{box-sizing:border-box;margin:0;padding:0}
.gdc-landing{scroll-behavior:smooth}
.gdc-landing{background:var(--bg);color:var(--ink);font-family:var(--body);line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.gdc-landing a{color:inherit;text-decoration:none}
.gdc-landing .wrap{max-width:1200px;margin:0 auto;padding:0 26px}
.gdc-landing .label{font-family:var(--mono);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.gdc-landing .btn{display:inline-flex;align-items:center;gap:.5rem;font-family:var(--mono);font-weight:700;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;padding:.85rem 1.5rem;border-radius:100px;border:1px solid transparent;cursor:pointer;transition:.18s}
.gdc-landing .btn:active{transform:translateY(1px)}
.gdc-landing .btn-neon{background:var(--neon);color:#000}
.gdc-landing .btn-neon:hover{box-shadow:0 8px 34px rgba(0,245,196,.35);transform:translateY(-1px)}
.gdc-landing .btn-ghost{background:transparent;color:var(--ink);border-color:var(--line-2)}
.gdc-landing .btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.gdc-landing .siteright .btn{border-radius:10px;padding:.72rem 1.15rem;font-size:.72rem;letter-spacing:.06em}
.gdc-landing .btn-ghost:hover{border-color:var(--neon);color:var(--neon)}
.gdc-landing header.site{position:sticky;top:0;z-index:60;background:rgba(0,0,0,.82);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.gdc-landing .siterow{display:flex;align-items:flex-end;justify-content:space-between;padding:18px 0 16px}
.gdc-landing .logo-eye{font-family:var(--mono);font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem}
.gdc-landing .logo-eye .d{width:6px;height:6px;border-radius:50%;background:var(--neon);box-shadow:0 0 8px var(--neon)}
.gdc-landing .wordmark{font-family:var(--disp);font-size:2.5rem;line-height:.85;letter-spacing:.015em;background:linear-gradient(135deg,#f0f0f8 30%,var(--neon) 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.gdc-landing .siteright{display:flex;align-items:center;gap:1.4rem}
.gdc-landing .siteright a.link{font-family:var(--mono);font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.gdc-landing .siteright a.link:hover{color:var(--ink)}
.gdc-landing .burger{display:none;flex-shrink:0;width:36px;height:32px;border:1px solid #1e1e30;border-radius:6px;background:transparent;cursor:pointer;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:0}
.gdc-landing .burger span{display:block;width:15px;height:2px;background:var(--ink);border-radius:2px}
.gdc-landing .burgermenu{display:none;flex-direction:column;margin:0 16px 12px;background:#0c0c0f;border:1px solid var(--line-2);border-radius:10px;overflow:hidden}
.gdc-landing .burgermenu.open{display:flex}
.gdc-landing .burgermenu a{padding:.9rem 1rem;font-family:var(--mono);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);border-bottom:1px solid var(--line)}
.gdc-landing .burgermenu a:last-child{border-bottom:0}
.gdc-landing .burgermenu a:hover{background:rgba(255,255,255,.04);color:var(--neon)}
@media(max-width:760px){
.gdc-landing .wordmark{font-size:1.9rem}
.gdc-landing .siteright .link{display:none}
}
@media(max-width:640px){
.gdc-landing .siterow{display:grid;grid-template-columns:52px 1fr 52px;align-items:center;gap:0;padding:14px 0}
.gdc-landing .burger{display:flex;justify-self:start;margin-left:14px}
.gdc-landing .logo-eye{display:none}
.gdc-landing .siteright{display:none}
.gdc-landing .wordmark{font-size:1.55rem;text-align:center}
}
.gdc-landing /* HERO with image */
  .hero{position:relative;padding:98px 0 64px;overflow:hidden}
.gdc-landing .hero-bg{position:absolute;inset:0;z-index:0;background:url('https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_060736_6ca7550a-4c9d-4b3f-9589-1fdafe3da0a1.png') center right/cover}
.gdc-landing .hero-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,#000 0%,#000 33%,rgba(0,0,0,.72) 60%,rgba(0,0,0,.32) 100%),linear-gradient(0deg,#000 2%,transparent 32%,transparent 78%,rgba(0,0,0,.6) 100%)}
.gdc-landing .herogrid{position:relative;z-index:1;display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}
@media(max-width:920px){
.gdc-landing .herogrid{grid-template-columns:1fr;gap:36px}
}
.gdc-landing .hero h1{font-family:var(--disp);font-size:clamp(3rem,7.2vw,5.8rem);line-height:.9;letter-spacing:.01em;margin:1rem 0 1.1rem}
.gdc-landing .hero h1 .a{color:var(--neon)}
.gdc-landing .hero h1 .b{color:var(--amber)}
.gdc-landing .hero .heroline{font-family:var(--mono);font-weight:700;font-size:clamp(.85rem,1.5vw,1.05rem);letter-spacing:.12em;text-transform:uppercase;line-height:1.3;margin:.2rem 0 1.2rem;color:#fff}
.gdc-landing .hero .heroline .a{color:var(--amber)}
.gdc-landing .hero p.lede{font-size:1.14rem;color:#cfcfd6;max-width:40ch;margin-bottom:1.8rem}
.gdc-landing .hero .lede .hl{color:var(--neon);font-weight:700}
.gdc-landing .hero-cta{display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.7rem}
.gdc-landing .kpis{display:flex;gap:2rem;flex-wrap:wrap}
.gdc-landing .kpi .n{font-family:var(--disp);font-size:2rem;line-height:1;color:var(--neon)}
.gdc-landing .kpi .l{font-family:var(--mono);font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-top:.2rem}
.gdc-landing .stepbar{border-bottom:1px solid var(--line);background:rgba(255,255,255,.015);padding:30px 0}
.gdc-landing .hero-steps{display:flex;flex-wrap:wrap;gap:.3rem 1.6rem;align-items:center;justify-content:center;text-align:center;font-family:var(--disp);letter-spacing:.02em;text-transform:uppercase;color:var(--ink);line-height:1}
.gdc-landing .hero-steps b{font-weight:400;font-size:clamp(1.5rem,3.4vw,2.7rem)}
.gdc-landing .hero-steps i{color:var(--neon);font-style:normal;font-size:clamp(1.3rem,2.6vw,2.1rem)}
@media(max-width:600px){
.gdc-landing .hero-steps{flex-direction:column;gap:.7rem}
.gdc-landing .hero-steps b{font-size:2.3rem}
.gdc-landing .hero-steps i{transform:rotate(90deg);font-size:1.6rem}
}
.gdc-landing /* compare / contrast table */
  .cmp{display:grid;grid-template-columns:1fr 1fr;max-width:960px;margin:0 auto;border-top:1px solid var(--line-2)}
.gdc-landing .cmp .h{font-family:var(--disp);font-size:1.9rem;letter-spacing:.02em;padding:0 22px 16px;display:flex;flex-direction:column;gap:.15rem}
.gdc-landing .cmp .h small{font-family:var(--mono);font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.gdc-landing .cmp .h.mobile{color:var(--neon)}
.gdc-landing .cmp .h.club{color:var(--amber)}
.gdc-landing .cmp .c{padding:16px 22px;border-top:1px solid var(--line);color:var(--ink);font-size:.98rem;position:relative}
.gdc-landing .cmp .c.pad{padding-left:38px}
.gdc-landing .cmp .c.pad::before{content:"";position:absolute;left:22px;top:21px;width:7px;height:7px;border-radius:50%}
.gdc-landing .cmp .c.mobile.pad::before{background:var(--neon)}
.gdc-landing .cmp .c.club.pad::before{background:var(--amber)}
.gdc-landing .cmp .c.diff{background:rgba(255,255,255,.02)}
.gdc-landing .cmp > .mobile{border-right:1px solid var(--line-2)}
@media(max-width:640px){
.gdc-landing .cmp{grid-template-columns:1fr}
.gdc-landing .cmp > .mobile{border-right:0}
}
.gdc-landing /* host preview mini-cards under each flow */
  .cmp .prevcell{padding:22px;border-top:1px solid var(--line);align-self:start}
.gdc-landing .prevlabel{font-family:var(--mono);font-size:.58rem;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-bottom:12px}
.gdc-landing .hprev{background:#050507;border:1px solid var(--line-2);border-radius:16px;padding:16px 16px 18px}
.gdc-landing .hprev .htitle{font-family:var(--disp);font-size:1.15rem;letter-spacing:.02em;margin-bottom:2px}
.gdc-landing .hprev .hsub{font-family:var(--body);font-size:.7rem;color:var(--faint);margin-bottom:12px;line-height:1.4}
.gdc-landing .hprev .lab{font-family:var(--mono);font-size:.52rem;letter-spacing:.13em;text-transform:uppercase;color:var(--neon);margin:.7rem 0 .32rem}
.gdc-landing .hprev .lab.s{color:var(--faint)}
.gdc-landing .hprev .sel{position:relative;background:rgba(255,255,255,.02);border:1px solid rgba(0,245,196,.5);border-radius:9px;padding:.55rem 1.6rem .55rem .7rem;font-size:.85rem;color:var(--ink)}
.gdc-landing .hprev .sel::after{content:'▾';position:absolute;right:.7rem;top:50%;transform:translateY(-50%);color:var(--neon);font-size:.7rem}
.gdc-landing .hprev .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.gdc-landing .hprev .field{position:relative;background:rgba(255,255,255,.015);border:1px solid var(--line);border-radius:9px;padding:.55rem 3.4rem .55rem .7rem;font-size:.85rem;color:var(--muted)}
.gdc-landing .hprev .field .sample{position:absolute;right:.7rem;top:50%;transform:translateY(-50%);font-family:var(--mono);font-size:.5rem;letter-spacing:.14em;text-transform:uppercase;color:var(--neon)}
.gdc-landing .hprev .pkg{margin-top:6px;border-radius:12px;overflow:hidden;border:1px solid var(--line-2)}
.gdc-landing .hprev .pkg .ph{display:flex;justify-content:space-between;align-items:center;background:#eef0f2;color:#0a0a0f;font-family:var(--disp);font-size:1.02rem;letter-spacing:.03em;padding:.5rem .8rem}
.gdc-landing .hprev .pkg .ph b{color:#0aa77e;font-weight:400}
.gdc-landing .hprev .pkg .bd2{position:relative;background:#0a0a0f;padding:.7rem .8rem 1.2rem;font-size:.78rem;color:var(--muted);line-height:1.75}
.gdc-landing .hprev .pkg .chk{position:absolute;right:.7rem;bottom:.7rem;width:18px;height:18px;border-radius:50%;background:#fff;color:#0a0a0f;font-size:.58rem;display:flex;align-items:center;justify-content:center}
.gdc-landing .cmp .club .hprev .lab{color:var(--amber)}
.gdc-landing .cmp .club .hprev .lab.s{color:var(--faint)}
.gdc-landing .cmp .club .hprev .sel{border-color:rgba(245,230,66,.5)}
.gdc-landing .cmp .club .hprev .sel::after{color:var(--amber)}
.gdc-landing .cmp .club .hprev .field .sample{color:var(--amber)}
.gdc-landing /* clickable button under each flow + full-size lightbox */
  .prevbtn{margin-top:2px;display:inline-flex;align-items:center;gap:.55rem;font-family:var(--mono);font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;font-weight:700;background:transparent;border:1px solid var(--neon);color:var(--neon);border-radius:100px;padding:.65rem 1.1rem;cursor:pointer;transition:.15s}
.gdc-landing .prevbtn:hover{background:var(--neon);color:#000}
.gdc-landing .prevbtn .dot{font-size:.6rem}
.gdc-landing .cmp .club .prevbtn{border-color:var(--amber);color:var(--amber)}
.gdc-landing .cmp .club .prevbtn:hover{background:var(--amber);color:#050507}
.gdc-landing .lb{position:fixed;inset:0;background:rgba(0,0,0,.85);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);z-index:200;display:none;align-items:flex-start;justify-content:center;padding:5vh 16px;overflow:auto}
.gdc-landing .lb.open{display:flex}
.gdc-landing .lb .sheet{width:100%;max-width:560px;background:#000;border:1px solid var(--line-2);border-radius:18px;padding:24px 22px 26px;position:relative;box-shadow:0 30px 80px rgba(0,0,0,.6)}
.gdc-landing .lb .x{position:absolute;top:14px;right:16px;background:none;border:none;color:var(--muted);font-size:1.4rem;cursor:pointer;line-height:1;z-index:2;width:30px;height:30px;border:1px solid var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center}
.gdc-landing .lb .x:hover{color:var(--ink);border-color:var(--line-2)}
.gdc-landing /* real booking-request form (matches live modal) — compact, .gdc-landing sample-filled */
  .hp{font-family:var(--body)}
.gdc-landing .hp .ey{font-family:var(--mono);font-size:.56rem;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.gdc-landing .hp .t{font-family:var(--disp);font-size:1.4rem;letter-spacing:.02em;color:var(--neon);margin:.2rem 0 .2rem}
.gdc-landing .hp .demo{font-family:var(--mono);font-size:.54rem;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-bottom:.9rem}
.gdc-landing .hp .demo b{color:var(--neon);font-weight:700;font-size:.66rem}
.gdc-landing .hp .lb2{display:block;font-family:var(--mono);font-size:.55rem;letter-spacing:.1em;text-transform:uppercase;color:#b7b7c2;margin:.72rem 0 .28rem}
.gdc-landing .hp .lb2 i{font-style:normal;text-transform:none;letter-spacing:0;color:var(--faint);font-family:var(--body);font-size:.7rem}
.gdc-landing .hp .lb2 .val{float:right;font-family:var(--body);letter-spacing:0;text-transform:none;color:#fff;font-weight:700;font-size:.86rem}
.gdc-landing .hp .help{font-size:.68rem;color:var(--faint);margin-top:.25rem}
.gdc-landing .hp .fld, .gdc-landing .hp .sel{width:100%;height:40px;display:flex;align-items:center;background:#0c0c11;border:1px solid var(--line);border-radius:7px;padding:.46rem .65rem;font-size:.85rem;color:#fff;line-height:1.35}
.gdc-landing .hp textarea.fld, .gdc-landing .hp .fld[style*="min-height"]{height:auto}
.gdc-landing .hp .sel{position:relative;padding-right:1.8rem}
.gdc-landing .hp .sel.gray{color:#8a8a94}
.gdc-landing .hp .sel::after{content:'▾';position:absolute;right:.7rem;top:50%;transform:translateY(-50%);color:#9a9aa4;font-size:.68rem}
.gdc-landing .hp .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.gdc-landing .hp .addr{display:grid;grid-template-columns:auto 1fr;gap:8px}
.gdc-landing .hp .addr .sel{white-space:nowrap;padding-right:1.6rem}
.gdc-landing .hp .stepper{display:flex;align-items:center;justify-content:space-between}
.gdc-landing .hp .stepper .ar{color:var(--faint);font-size:.62rem;line-height:.85}
.gdc-landing /* sample packages + price */
  .hp .pkgbox{display:block;margin-top:.5rem;padding:0;border:1px solid var(--line-2);border-radius:10px;overflow:hidden}
.gdc-landing .hp .pkghd{display:flex;justify-content:space-between;align-items:center;width:100%;background:#eef0f2;color:#0a0a0f;padding:.5rem .75rem;font-family:var(--disp);font-size:1.15rem;letter-spacing:.03em}
.gdc-landing .hp .pkghd b{color:#0aa77e;font-weight:400}
.gdc-landing .hp .pkgbox{cursor:pointer;transition:border-color .15s,box-shadow .15s}
.gdc-landing .hp .pkgbox.on{border-color:var(--neon);box-shadow:0 0 0 2px rgba(0,245,196,.22)}
.gdc-landing .hp .pkgbox .chk{display:none}
.gdc-landing .hp .pkgbox.on .chk{display:inline}
.gdc-landing .hp .pkgbox + .pkgbox{margin-top:.5rem}
.gdc-landing .hp select.selin{width:100%;height:40px;background:#0c0c11;border:1px solid var(--line);border-radius:7px;padding:.46rem 1.9rem .46rem .65rem;font-size:.85rem;color:#fff;font-family:var(--body);-webkit-appearance:none;appearance:none;cursor:pointer;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='7' viewBox='0 0 10 7'><path d='M1 1l4 4 4-4' fill='none' stroke='%239a9aa4' stroke-width='1.6'/></svg>");background-repeat:no-repeat;background-position:right .7rem center}
.gdc-landing .hp select.selin:focus{outline:none;border-color:var(--neon)}
.gdc-landing .hp .wcard{background:#04120c;border:1px solid rgba(0,245,196,.35);border-radius:12px;padding:16px 18px;margin-top:.7rem}
.gdc-landing .hp .wey{font-family:var(--mono);font-size:.6rem;letter-spacing:.13em;text-transform:uppercase;color:var(--neon);margin-bottom:.6rem}
.gdc-landing .hp .wq{font-size:.98rem;color:#fff;margin-bottom:.7rem}
.gdc-landing .hp .wyn{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.gdc-landing .hp .wyn button{display:flex;align-items:center;justify-content:center;gap:.5rem;background:#0c0c0f;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:.8rem;color:#dcdce2;font-family:var(--body);font-size:.85rem;cursor:pointer}
.gdc-landing .hp .wyn button::before{content:"";width:14px;height:14px;border-radius:50%;border:1.5px solid #7a7a86;flex-shrink:0}
.gdc-landing .hp .wyn button.on{color:#fff}
.gdc-landing .hp .wyn button.on::before{border-color:var(--neon);background:var(--neon);box-shadow:inset 0 0 0 2px #0c0c0f}
.gdc-landing .hp .wsub{margin-top:1rem}
.gdc-landing .hp .wsub .wq{margin-top:.9rem}
.gdc-landing .hp .wsub select.selin{height:48px;border-radius:8px;font-size:.9rem;padding-left:.8rem;border-color:rgba(255,255,255,.08)}
.gdc-landing .hp .pkghd .pkr{display:inline-flex;align-items:center;gap:.5rem}
.gdc-landing .hp .pkghd .chk{font-family:var(--mono);font-size:.5rem;letter-spacing:.08em;text-transform:uppercase;color:#0aa77e;font-weight:700}
.gdc-landing .hp .pkgli{list-style:none;margin:0;padding:.6rem .75rem;background:#000;font-size:.8rem;color:#c7c7d1;line-height:1.8}
.gdc-landing .hp .pkgli li{position:relative;padding-left:15px}
.gdc-landing .hp .pkgli li::before{content:"•";position:absolute;left:1px;color:#0aa77e}
.gdc-landing .hp .quote{margin-top:.7rem;border:1px solid var(--line-2);border-radius:10px;padding:.75rem .8rem}
.gdc-landing .hp .quote .ln{display:flex;justify-content:space-between;font-size:.8rem;color:#b7b7c2;padding:.16rem 0}
.gdc-landing .hp .quote .ln.tot{color:#fff;font-weight:600;border-top:1px solid var(--line);margin-top:.28rem;padding-top:.42rem}
.gdc-landing .hp .quote .ln.bal{color:var(--neon);font-weight:600}
.gdc-landing .hp textarea.fld{min-height:64px;resize:none;font-family:var(--body)}
.gdc-landing .hp .submit{margin-top:1rem;width:100%;background:var(--neon);color:#04120d;border:none;border-radius:100px;padding:.72rem;font-family:var(--mono);font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
.gdc-landing .hp.amber .t{color:var(--amber)}
.gdc-landing .hp.amber .demo b{color:var(--amber)}
.gdc-landing .hp.amber .quote .ln.bal{color:var(--amber)}
.gdc-landing .hp.amber .submit{background:var(--amber);color:#0a0a05}
.gdc-landing /* club booking form pieces */
  .hp .pills3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.gdc-landing .hp .pill{background:#0c0c11;border:1px solid var(--line);border-radius:8px;padding:.55rem;text-align:center;font-size:.85rem;color:#c7c7d1;cursor:pointer}
.gdc-landing .hp .pill.on{border-color:var(--amber);color:var(--amber);font-weight:600}
.gdc-landing .hp .addr2{display:grid;grid-template-columns:1fr auto;gap:8px}
.gdc-landing .hp .addr2 .sel{white-space:nowrap;padding-right:1.6rem}
.gdc-landing .hp .eq{display:block;width:100%;background:#0c0c11;border:1px solid var(--line);border-radius:8px;padding:.6rem;text-align:center;font-size:.85rem;color:#9a9aa4;margin-bottom:8px;cursor:pointer}
.gdc-landing .hp .rate-na{border:1px solid rgba(255,77,77,.5);background:rgba(255,77,77,.08);border-radius:10px;padding:.9rem;margin-top:.5rem;font-size:.82rem;line-height:1.4;color:#ff5a5a;text-align:center}
.gdc-landing .hp .eq.on{color:#fff;border-color:var(--amber);background:rgba(245,230,66,.08);box-shadow:0 0 0 1px rgba(245,230,66,.35)}
.gdc-landing .hp .eq.on[data-eq="na"]{color:#ff8a8a;border-color:#ff5a5a;background:rgba(255,77,77,.08);box-shadow:0 0 0 1px rgba(255,77,77,.3)}
.gdc-landing .hp .rate{border:1px solid var(--line-2);border-radius:10px;padding:.85rem .9rem;margin-top:.5rem}
.gdc-landing .hp .rate .est{display:flex;justify-content:space-between;align-items:center;margin-bottom:.55rem}
.gdc-landing .hp .rate .est span{font-family:var(--mono);font-size:.56rem;letter-spacing:.12em;text-transform:uppercase;color:#8b8b96}
.gdc-landing .hp .rate .est b{font-family:var(--disp);font-size:1.6rem;color:var(--amber);letter-spacing:.02em}
.gdc-landing .hp .rate .ln{display:flex;justify-content:space-between;font-size:.8rem;color:#b7b7c2;padding:.16rem 0}
.gdc-landing .hp .rate .ln.tot{color:#fff;font-weight:600;border-top:1px solid var(--line);margin-top:.28rem;padding-top:.42rem}
.gdc-landing .hp .rate .ln.bal{color:var(--amber);font-weight:600}
.gdc-landing .flow-list{list-style:none;margin:.4rem 0 0}
.gdc-landing .flow-list li{position:relative;padding:.55rem 0 .55rem 1.5rem;border-top:1px solid var(--line);color:var(--ink);font-size:.96rem;font-family:var(--body)}
.gdc-landing .flow-list li:first-child{border-top:0}
.gdc-landing .flow-list li::before{content:"";position:absolute;left:0;top:.95rem;width:7px;height:7px;border-radius:50%;background:var(--neon)}
.gdc-landing .type.club .flow-list li::before{background:var(--amber)}
.gdc-landing .djcard{position:relative;background:rgba(12,12,17,.82);backdrop-filter:blur(10px);border:1px solid rgba(0,245,196,.18);border-radius:16px;overflow:hidden;box-shadow:0 40px 100px rgba(0,0,0,.7),0 0 60px rgba(0,245,196,.06)}
.gdc-landing .djcard .top{padding:20px;display:flex;align-items:center;gap:14px;position:relative}
.gdc-landing .djcard .av{width:60px;height:60px;border-radius:14px;background:#111 center/cover}
.gdc-landing .djcard .tag{position:absolute;top:16px;right:16px;font-family:var(--mono);font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;background:rgba(0,245,196,.14);color:var(--neon);border:1px solid rgba(0,245,196,.3);padding:.3rem .55rem;border-radius:100px}
.gdc-landing .djcard .nm{font-family:var(--disp);font-size:1.7rem;line-height:1}
.gdc-landing .djcard .loc{font-family:var(--mono);font-size:.66rem;color:var(--muted);margin-top:.2rem}
.gdc-landing .djcard .body{padding:0 20px 8px}
.gdc-landing .pkg{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--line)}
.gdc-landing .pkg .p{font-family:var(--mono);font-size:.72rem;color:var(--muted)}
.gdc-landing .pkg .v{font-family:var(--disp);font-size:1.35rem}
.gdc-landing .djcard .foot{padding:14px 20px 20px}
.gdc-landing .djcard .book{width:100%;justify-content:center}
.gdc-landing .strip{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:20px 0;overflow:hidden;-webkit-mask:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)}
.gdc-landing .strip .track{display:flex;gap:52px;white-space:nowrap;animation:sx 24s linear infinite;font-family:var(--mono);font-size:.78rem;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
@keyframes sx{to{transform:translateX(-50%)}}
.gdc-landing section{padding:92px 0}
.gdc-landing .shead{text-align:center;max-width:720px;margin:0 auto 54px}
.gdc-landing .shead h2{font-family:var(--disp);font-size:clamp(2.4rem,5vw,3.6rem);line-height:.95;letter-spacing:.01em;margin:.7rem 0 .7rem}
.gdc-landing .shead p{color:var(--muted);font-size:1.06rem}
@media(min-width:1240px){
.gdc-landing #features .shead h2{white-space:nowrap;overflow:visible}
}
.gdc-landing /* TWO DJ TYPES + pipelines */
  /* 3 steps */
  .steps3{padding:74px 0 0}
.gdc-landing .s3grid{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:stretch;gap:14px}
.gdc-landing .s3{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px 24px}
.gdc-landing .s3 .n{font-family:var(--disp);font-size:2.4rem;color:var(--neon);line-height:1}
.gdc-landing .s3 h4{font-family:var(--disp);font-size:1.45rem;letter-spacing:.01em;margin:.35rem 0 .35rem}
.gdc-landing .s3 p{color:var(--muted);font-size:.9rem}
.gdc-landing .s3arrow{color:var(--neon);font-size:1.7rem;align-self:center}
@media(max-width:820px){
.gdc-landing .s3grid{grid-template-columns:1fr}
.gdc-landing .s3arrow{transform:rotate(90deg);justify-self:center}
}
.gdc-landing /* keep the two pipelines side-by-side for comparison */
  .types{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:600px){
.gdc-landing .types{grid-template-columns:1fr}
}
.gdc-landing .type{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:30px 28px;position:relative;overflow:hidden}
.gdc-landing .type.mobile{border-color:rgba(0,245,196,.28)}
.gdc-landing .type.club{border-color:rgba(245,230,66,.28)}
.gdc-landing .type .pill{font-family:var(--mono);font-size:.66rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:.4rem .85rem;border-radius:100px;display:inline-block}
.gdc-landing .type.mobile .pill{background:var(--neon);color:#000}
.gdc-landing .type.club .pill{background:var(--amber);color:#050507}
.gdc-landing .type h3{font-family:var(--disp);font-size:2.1rem;letter-spacing:.01em;margin:.9rem 0 .35rem}
.gdc-landing .type p{color:var(--muted);font-size:.95rem;margin-bottom:1.6rem;max-width:34ch}
.gdc-landing .type .plt{font-family:var(--mono);font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-bottom:1rem}
.gdc-landing .pipeline{display:flex;align-items:flex-start}
.gdc-landing .pnode{flex:1;min-width:0;text-align:center;position:relative;padding:0 2px}
.gdc-landing .pnode .circ{width:46px;height:46px;border-radius:50%;border:1px solid var(--line-2);background:var(--card-2);display:grid;place-items:center;margin:0 auto;position:relative;z-index:1}
.gdc-landing .type.mobile .pnode .circ svg{stroke:var(--neon)}
.gdc-landing .type.club .pnode .circ svg{stroke:var(--amber)}
.gdc-landing .pnode .circ svg{width:20px;height:20px;fill:none}
.gdc-landing .pnode .plab{font-family:var(--mono);font-size:.58rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-top:.55rem;line-height:1.3}
.gdc-landing .pnode:not(:last-child)::after{content:"";position:absolute;top:23px;left:50%;width:100%;height:2px;z-index:0}
.gdc-landing .type.mobile .pnode:not(:last-child)::after{background:linear-gradient(90deg,rgba(0,245,196,.7),rgba(0,245,196,.15))}
.gdc-landing .type.club .pnode:not(:last-child)::after{background:linear-gradient(90deg,rgba(245,230,66,.7),rgba(245,230,66,.15))}
.gdc-landing .types-note{text-align:center;color:var(--muted);font-size:.95rem;margin-top:12px}
.gdc-landing .types-note b{color:var(--ink)}
.gdc-landing /* two-flow glow cards — colored header, .gdc-landing no box */
  .flowcards{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(9,auto);gap:0;max-width:940px;margin:0 auto;border-top:1px solid var(--line-2)}
.gdc-landing .flowcards .flane{position:relative;padding:0 30px 26px;counter-reset:step;display:grid;grid-template-rows:subgrid;grid-row:1 / -1;align-content:start}
.gdc-landing .flowcards .flane.mobile{border-right:1px solid var(--line-2)}
.gdc-landing .flowcards .fh{position:relative;font-family:var(--disp);font-size:1.9rem;letter-spacing:.02em;display:flex;flex-direction:column;gap:.12rem;padding:15px 22px;margin:0 -30px 0;border-bottom:2px solid}
.gdc-landing .flowcards .fh small{font-family:var(--mono);font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.gdc-landing .flowcards .flane.mobile .fh{background:linear-gradient(180deg,rgba(0,245,196,.12),transparent);color:var(--neon);border-bottom-color:rgba(0,245,196,.35)}
.gdc-landing .flowcards .flane.club .fh{background:linear-gradient(180deg,rgba(245,230,66,.12),transparent);color:var(--amber);border-bottom-color:rgba(245,230,66,.35)}
.gdc-landing .flowcards .fhbtn{position:absolute;top:16px;right:20px;display:inline-flex;align-items:center;font-family:var(--mono);font-weight:700;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;background:none;border:none;padding:0;cursor:pointer;text-decoration:none;transition:opacity .15s}
.gdc-landing .flowcards .flane.mobile .fhbtn{color:var(--neon)}
.gdc-landing .flowcards .flane.club .fhbtn{color:var(--amber)}
.gdc-landing .flowcards .fhbtn:hover{opacity:.7}
.gdc-landing .flowcards .fli{counter-increment:step;padding:16px 0;border-top:1px solid var(--line);font-size:.86rem;font-weight:500;line-height:1.5;color:#c9c9d3;letter-spacing:.005em;display:grid;grid-template-columns:auto 1fr;column-gap:18px;align-items:center}
.gdc-landing .flowcards .fli:first-of-type{border-top:0}
.gdc-landing .flowcards .fli .smk{display:block;text-align:center;min-width:56px;padding-right:16px;line-height:1;font-family:var(--mono);font-weight:700;font-size:.46rem;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.gdc-landing .flowcards .fli .smk::after{content:counter(step,decimal-leading-zero);display:block;font-family:var(--disp);font-weight:400;font-size:1.95rem;letter-spacing:.02em;margin-top:3px}
.gdc-landing .flowcards .flane.mobile .fli .smk{border-right:2px solid var(--neon)}
.gdc-landing .flowcards .flane.club .fli .smk{border-right:2px solid var(--amber)}
.gdc-landing .flowcards .flane.mobile .fli .smk::after{color:var(--neon)}
.gdc-landing .flowcards .flane.club .fli .smk::after{color:var(--amber)}
.gdc-landing .flowcards .fli.topalign{align-items:flex-start}
.gdc-landing .flowcards .finote{margin-top:14px;font-size:.72rem;line-height:1.45;color:var(--faint);font-style:italic;font-weight:400}
.gdc-landing .flowcards .viewsample{display:inline;margin-left:8px;white-space:nowrap;font-family:var(--mono);font-weight:700;font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
.gdc-landing .flowcards .flane.mobile .viewsample{color:var(--neon)}
.gdc-landing .flowcards .flane.club .viewsample{color:var(--amber)}
.gdc-landing .flowcards .fbtn{margin-top:20px;display:inline-flex;align-items:center;gap:.55rem;font-family:var(--mono);font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;font-weight:700;background:transparent;border:1px solid var(--neon);color:var(--neon);border-radius:100px;padding:.65rem 1.1rem;cursor:pointer;transition:.15s}
.gdc-landing .flowcards .fbtn:hover{background:var(--neon);color:#000}
.gdc-landing .flowcards .flane.club .fbtn{border-color:var(--amber);color:var(--amber)}
.gdc-landing .flowcards .flane.club .fbtn:hover{background:var(--amber);color:#050507}
@media(max-width:640px){
.gdc-landing .flowcards{grid-template-columns:1fr;grid-template-rows:none}
.gdc-landing .flowcards .flane{display:block;grid-row:auto}
.gdc-landing .flowcards .flane.mobile{border-right:0;border-bottom:1px solid var(--line-2)}
}
.gdc-landing /* features */
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:900px){
.gdc-landing .grid{grid-template-columns:1fr 1fr}
}
@media(max-width:580px){
.gdc-landing .grid{grid-template-columns:1fr}
}
.gdc-landing .fcard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px;transition:.22s}
.gdc-landing .fcard:hover{border-color:rgba(0,245,196,.35);transform:translateY(-3px)}
.gdc-landing .fcard .ic{width:46px;height:46px;border-radius:12px;background:rgba(0,245,196,.1);border:1px solid rgba(0,245,196,.22);display:grid;place-items:center;margin-bottom:16px}
.gdc-landing .fcard .ic svg{width:22px;height:22px;stroke:var(--neon)}
.gdc-landing .ficon{width:48px;height:48px;max-width:48px;border-radius:12px;object-fit:cover;display:block;margin-bottom:16px}
.gdc-landing .fcard h3{font-family:var(--disp);font-size:1.5rem;letter-spacing:.01em;margin-bottom:.35rem}
.gdc-landing .fcard p{color:var(--muted);font-size:.92rem}
.gdc-landing .fcard .pays{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}
.gdc-landing .fcard .pays span{font-family:var(--mono);font-size:.62rem;letter-spacing:.06em;text-transform:uppercase;padding:.35rem .6rem;border:1px solid var(--line-2);border-radius:100px;color:var(--muted)}
.gdc-landing .fcard .use{display:inline-block;margin-top:13px;font-family:var(--mono);font-size:.56rem;letter-spacing:.06em;text-transform:uppercase;padding:.3rem .6rem;border-radius:100px}
.gdc-landing .use.mobile{background:rgba(0,245,196,.12);color:var(--neon);border:1px solid rgba(0,245,196,.32)}
.gdc-landing .use.club{background:rgba(245,230,66,.12);color:var(--amber);border:1px solid rgba(245,230,66,.32)}
.gdc-landing .use.both{background:rgba(255,255,255,.05);color:var(--muted);border:1px solid var(--line-2)}
.gdc-landing /* features as a clean list (layout C) */
  .flist{border-top:1px solid var(--line);max-width:1000px;margin:0 auto}
.gdc-landing .flist .r{display:flex;gap:18px;align-items:center;padding:18px 6px;border-bottom:1px solid var(--line);position:relative}
.gdc-landing .flist .r img{width:42px;height:42px;border-radius:11px;object-fit:cover;flex-shrink:0}
.gdc-landing .flist h3{font-family:var(--disp);font-size:1.3rem;letter-spacing:.01em;min-width:220px}
.gdc-landing .flist p{color:var(--muted);font-size:.82rem;line-height:1.5;flex:1;margin:0}
.gdc-landing .flist .titlecol{min-width:170px}
.gdc-landing .flist .tg{position:absolute;bottom:8px;right:2px;font-family:var(--mono);font-size:.44rem;letter-spacing:.06em;text-transform:uppercase;font-weight:700;border-radius:5px;padding:.16rem .44rem;white-space:nowrap;line-height:1.3;z-index:2}
.gdc-landing .flist .tg.mobile{background:var(--neon);color:#04120d}
.gdc-landing .flist .tg.club{background:var(--amber);color:#0a0a05}
.gdc-landing .flist .tg.both{background:rgba(255,255,255,.08);color:var(--muted)}
@media(max-width:640px){
.gdc-landing .flist .r{flex-wrap:wrap}
.gdc-landing .flist h3{min-width:0;flex-basis:calc(100% - 60px)}
.gdc-landing .flist p{flex-basis:100%}
}
.gdc-landing .flist .paylist{display:block;margin-top:10px;font-family:var(--mono);font-size:.66rem;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}
.gdc-landing .flist .paylist b{font-weight:700;color:var(--ink)}
.gdc-landing .flist .paylist i{color:var(--faint);font-style:normal;margin:0 .5rem}
.gdc-landing .flist .paylist .pm-sub{color:var(--ink)}
.gdc-landing .flist .samplelink{color:var(--neon);font-family:var(--mono);font-weight:700;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;white-space:nowrap}
.gdc-landing .flist .samplelink.club{color:var(--amber)}
.gdc-landing .flist .r.framed{border:1.5px solid var(--neon);border-radius:14px;padding:18px 6px;margin:6px 0;box-shadow:0 0 0 1px rgba(0,245,196,.12),0 0 30px rgba(0,245,196,.12);background:linear-gradient(180deg,rgba(0,245,196,.05),transparent)}
.gdc-landing .flist .r.framed-amber{border:1.5px solid var(--amber);border-radius:14px;padding:18px 6px;margin:6px 0;box-shadow:0 0 0 1px rgba(245,230,66,.12),0 0 30px rgba(245,230,66,.12);background:linear-gradient(180deg,rgba(245,230,66,.05),transparent)}
.gdc-landing .roletbl.club th{color:var(--amber)}
.gdc-landing .roletbl.club .yes{color:var(--amber)}
.gdc-landing /* roles permission sample */
  .rolewrap .rolehd{font-family:var(--disp);font-size:1.5rem;letter-spacing:.02em;margin-bottom:16px}
.gdc-landing .roletbl{width:100%;border-collapse:collapse}
.gdc-landing .roletbl th{font-family:var(--mono);font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--neon);text-align:center;padding:0 6px 12px}
.gdc-landing .roletbl th.lbl{text-align:left}
.gdc-landing .roletbl td{padding:9px 6px;border-top:1px solid var(--line);text-align:center;font-size:1rem}
.gdc-landing .roletbl td.lbl{text-align:left;color:#e6e6ec;font-size:.85rem;font-family:var(--body)}
.gdc-landing .roletbl .yes{color:var(--neon)}
.gdc-landing .roletbl .no{color:#ff6b6b}
.gdc-landing .rolenote{font-size:.72rem;color:var(--faint);margin-top:14px}
.gdc-landing /* demo */
  .demo-sec{background:radial-gradient(1000px 380px at 50% -10%,rgba(0,245,196,.06),transparent),#040406}
.gdc-landing .demoshell{max-width:520px;margin:0 auto;background:var(--card);border:1px solid var(--line-2);border-radius:18px;overflow:hidden;box-shadow:0 40px 90px rgba(0,0,0,.6)}
.gdc-landing .dhead{display:flex;align-items:center;gap:.55rem;padding:15px 20px;border-bottom:1px solid var(--line)}
.gdc-landing .dhead .b{font-family:var(--disp);font-size:1.2rem;letter-spacing:.02em;display:flex;align-items:center;gap:.5rem}
.gdc-landing .dhead .b .m{width:26px;height:26px;border-radius:8px;background:#111 center/cover}
.gdc-landing .dhead .tag{margin-left:auto;font-family:var(--mono);font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);border:1px solid var(--line);padding:.24rem .55rem;border-radius:100px}
.gdc-landing .prog{display:flex;gap:6px;padding:16px 20px 2px}
.gdc-landing .prog i{flex:1;height:5px;border-radius:99px;background:rgba(255,255,255,.09);transition:.3s}
.gdc-landing .prog i.on{background:var(--neon)}
.gdc-landing .dbody{padding:22px 20px 6px;min-height:302px}
.gdc-landing .dbody .sl{font-family:var(--mono);font-size:.66rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--neon);margin-bottom:.5rem}
.gdc-landing .dbody h3{font-family:var(--disp);font-size:1.9rem;letter-spacing:.01em;margin-bottom:1.1rem}
.gdc-landing .lab{font-family:var(--mono);font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:.5rem}
.gdc-landing .chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.gdc-landing .chip{font-family:var(--mono);font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;padding:.58rem .9rem;border-radius:100px;border:1px solid var(--line-2);background:rgba(255,255,255,.02);cursor:pointer;transition:.14s}
.gdc-landing .chip:hover{border-color:rgba(0,245,196,.5)}
.gdc-landing .chip.sel{background:var(--neon);border-color:var(--neon);color:#000;font-weight:700}
.gdc-landing .fld{width:100%;padding:.82rem .95rem;border-radius:11px;border:1px solid var(--line-2);background:rgba(255,255,255,.02);color:var(--ink);font-family:var(--body);font-size:.95rem;margin-bottom:14px}
.gdc-landing .fld:focus{outline:none;border-color:var(--neon)}
.gdc-landing .quote{background:rgba(255,255,255,.02);border:1px solid var(--line);border-radius:13px;padding:16px 18px;margin-bottom:16px}
.gdc-landing .ql{display:flex;justify-content:space-between;padding:.36rem 0;font-size:.92rem;color:var(--muted)}
.gdc-landing .ql b{color:var(--ink);font-family:var(--mono);font-weight:700}
.gdc-landing .qtot{border-top:1px dashed var(--line-2);margin-top:.4rem;padding-top:.6rem !important}
.gdc-landing .qtot span:first-child{font-family:var(--disp);font-size:1.2rem;letter-spacing:.02em;color:var(--ink)}
.gdc-landing .qtot b{color:var(--neon);font-family:var(--disp);font-size:1.4rem}
.gdc-landing .pm{display:flex;gap:8px;margin-bottom:16px}
.gdc-landing .pm div{flex:1;text-align:center;font-family:var(--mono);font-size:.7rem;letter-spacing:.05em;text-transform:uppercase;padding:.72rem;border-radius:100px;border:1px solid var(--line-2);background:rgba(255,255,255,.02);cursor:pointer;transition:.14s}
.gdc-landing .pm div.sel{border-color:var(--neon);background:rgba(0,245,196,.12);color:var(--neon)}
.gdc-landing .dfoot{display:flex;align-items:center;gap:.7rem;padding:6px 20px 22px}
.gdc-landing .dfoot .back{margin-right:auto;font-family:var(--mono);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);background:none;border:0;cursor:pointer}
.gdc-landing .dfoot .back:hover{color:var(--ink)}
.gdc-landing .succ{text-align:center;padding:4px 0}
.gdc-landing .succ .ok{width:64px;height:64px;border-radius:50%;background:rgba(0,245,196,.14);border:1px solid rgba(0,245,196,.3);display:grid;place-items:center;margin:4px auto 14px}
.gdc-landing .summ{text-align:left;background:rgba(255,255,255,.02);border:1px solid var(--line);border-radius:13px;padding:14px 16px;margin:14px 0}
.gdc-landing .summ .r{display:flex;justify-content:space-between;padding:.3rem 0;font-size:.88rem;color:var(--muted)}
.gdc-landing .summ .r b{color:var(--ink);font-family:var(--mono);font-weight:700}
.gdc-landing .fadein{animation:fu .34s cubic-bezier(.2,.8,.2,1)}
@keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.gdc-landing /* setup walkthrough bits */
  .setwrap{border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:14px}
.gdc-landing .setrow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:.7rem .9rem;border-top:1px solid var(--line);font-size:.9rem;color:var(--muted)}
.gdc-landing .setrow:first-child{border-top:0}
.gdc-landing .setrow b{color:var(--ink);font-family:var(--mono);font-weight:700;font-size:.78rem;letter-spacing:.03em}
.gdc-landing .paysel{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.gdc-landing .paysel span{font-family:var(--mono);font-size:.58rem;letter-spacing:.04em;text-transform:uppercase;padding:.26rem .5rem;border-radius:100px;border:1px solid var(--neon);color:var(--neon)}
.gdc-landing .pkgrow{display:flex;justify-content:space-between;align-items:center;padding:.65rem .9rem;border:1px solid var(--line);border-radius:11px;margin-bottom:8px;font-family:var(--mono);font-size:.82rem;color:var(--muted)}
.gdc-landing .pkgrow .v{font-family:var(--disp);font-size:1.25rem;color:var(--ink);letter-spacing:.02em}
.gdc-landing .ctr{border:1px solid var(--line);border-radius:11px;padding:14px 16px;font-size:.8rem;color:var(--muted);line-height:1.55;background:rgba(255,255,255,.02);position:relative;max-height:150px;overflow:hidden;margin-bottom:14px}
.gdc-landing .ctr::after{content:"";position:absolute;left:0;right:0;bottom:0;height:46px;background:linear-gradient(transparent,var(--card))}
.gdc-landing .ctr h5{font-family:var(--disp);font-size:1.1rem;color:var(--ink);letter-spacing:.02em;margin-bottom:.4rem}
.gdc-landing .dim{color:var(--muted)}
.gdc-landing .livebox{text-align:center}
.gdc-landing .livebox .url{font-family:var(--mono);font-size:.92rem;color:var(--neon);background:rgba(0,245,196,.1);border:1px solid rgba(0,245,196,.3);border-radius:100px;padding:.55rem 1rem;display:inline-block;margin:.5rem 0 1.1rem}
.gdc-landing .mini-pipe{display:flex;margin-top:8px}
.gdc-landing .mini-pipe .pn{flex:1;text-align:center;position:relative;font-family:var(--mono);font-size:.55rem;letter-spacing:.03em;text-transform:uppercase;color:var(--muted)}
.gdc-landing .mini-pipe .pn .c{width:34px;height:34px;border-radius:50%;border:1px solid var(--neon);background:rgba(0,245,196,.12);display:grid;place-items:center;margin:0 auto 6px;color:var(--neon);font-family:var(--disp);font-size:.95rem}
.gdc-landing .mini-pipe .pn:not(:last-child)::after{content:"";position:absolute;top:16px;left:50%;width:100%;height:2px;background:linear-gradient(90deg,var(--neon),rgba(0,245,196,.2));z-index:0}
.gdc-landing .price{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;max-width:1200px;margin:0 auto;align-items:stretch}
@media(max-width:980px){
.gdc-landing .price{grid-template-columns:repeat(2,1fr)}
}
@media(max-width:560px){
.gdc-landing .price{grid-template-columns:1fr}
}
.gdc-landing .plan{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px 18px;position:relative;display:flex;flex-direction:column}
.gdc-landing .plan.pro{border-color:rgba(0,245,196,.4)}
.gdc-landing .plan .pn{font-family:var(--mono);font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
.gdc-landing .plan.pro .pn{color:var(--neon)}
.gdc-landing .plan .amt{font-family:var(--disp);font-size:2.2rem;letter-spacing:.01em;margin:.35rem 0 .1rem}
.gdc-landing .plan .amt span{font-family:var(--mono);font-size:.66rem;color:var(--faint)}
.gdc-landing .plan .yr{font-family:var(--mono);font-size:.58rem;letter-spacing:.05em;color:var(--faint);text-transform:uppercase}
.gdc-landing .plan ul{list-style:none;margin:14px 0 18px;flex:1}
.gdc-landing .plan li{padding:.4rem 0;color:var(--muted);font-size:.8rem;line-height:1.35;display:flex;gap:.5rem;align-items:flex-start}
.gdc-landing .plan li svg{width:16px;height:16px;stroke:var(--neon);flex-shrink:0;margin-top:3px;fill:none}
.gdc-landing .plan li.no{color:var(--faint);font-style:italic;padding-left:22px;position:relative}
.gdc-landing .plan li.no::before{content:"—";position:absolute;left:2px;color:var(--faint)}
.gdc-landing .plan .btn{width:100%;justify-content:center}
.gdc-landing .best{position:absolute;top:-11px;right:22px;font-family:var(--mono);font-size:.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;background:var(--neon);color:#000;padding:.3rem .7rem;border-radius:100px}
.gdc-landing .band{position:relative;overflow:hidden;border:1px solid var(--line-2);border-radius:22px;padding:66px 40px;text-align:center;background:radial-gradient(700px 300px at 50% 0,rgba(0,245,196,.1),transparent)}
.gdc-landing .band h2{font-family:var(--disp);font-size:clamp(2.4rem,5vw,3.6rem);letter-spacing:.01em;margin-bottom:.6rem}
.gdc-landing .band p{color:var(--muted);margin-bottom:1.6rem;font-size:1.04rem}
.gdc-landing footer{border-top:1px solid var(--line);padding:34px 0}
.gdc-landing .frow{display:flex;justify-content:space-between;flex-wrap:wrap;gap:14px;align-items:center;font-family:var(--mono);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.gdc-landing .frow a:hover{color:var(--ink)}
.gdc-landing .frow .wm{font-family:var(--disp);font-size:1.2rem;letter-spacing:.02em;color:var(--muted)}
.gdc-landing /* how it works (text) */
  .howtabs{display:flex;gap:8px;justify-content:center;margin-bottom:28px}
.gdc-landing .howtab{font-family:var(--mono);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;padding:.62rem 1.2rem;border-radius:100px;border:1px solid var(--line-2);background:rgba(255,255,255,.02);color:var(--muted);cursor:pointer;transition:.15s}
.gdc-landing .howtab.on{background:var(--neon);border-color:var(--neon);color:#000;font-weight:700}
.gdc-landing .howcard{max-width:680px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:30px 32px}
.gdc-landing .howstep{display:grid;grid-template-columns:26px 1fr;gap:14px;align-items:start;min-height:52px;padding:6px 0}
.gdc-landing .howstep .num{font-family:var(--disp);font-size:1.4rem;color:var(--neon);line-height:1.1}
.gdc-landing .howstep .t{font-size:.92rem;color:var(--ink);padding-top:2px}
.gdc-landing .howstep .optional{color:var(--faint);font-size:.8rem;font-family:var(--mono);letter-spacing:.04em}
.gdc-landing .hownote{margin-top:auto;padding:18px 0 0;border-top:1px solid var(--line);color:var(--muted);font-size:.93rem;line-height:1.55;min-height:88px}
@media(max-width:760px){
.gdc-landing .hownote{min-height:0}
}
.gdc-landing .hownote b{color:var(--ink)}
.gdc-landing .howgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:920px;margin:0 auto}
@media(max-width:760px){
.gdc-landing .howgrid{grid-template-columns:1fr}
}
.gdc-landing .howcol{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px 28px;display:flex;flex-direction:column}
.gdc-landing .howh{font-family:var(--disp);font-size:1.7rem;letter-spacing:.01em;margin-bottom:8px}
.gdc-landing .howcol.mobile .howh{color:var(--neon)}
.gdc-landing .howcol.club .howh{color:var(--amber)}
.gdc-landing .howcol.club .howstep .num{color:var(--amber)}
.gdc-landing .reveal{opacity:0;transform:translateY(22px);transition:.7s cubic-bezier(.2,.8,.2,1)}
.gdc-landing .reveal.in{opacity:1;transform:none}
.gdc-landing .searchbar{border-bottom:1px solid var(--line);background:#000}
.gdc-landing .searchbar .wrap{display:flex;align-items:center;gap:10px;padding-top:16px;padding-bottom:16px;max-width:none;margin:0;padding-left:4rem;padding-right:4rem}
@media(max-width:900px){
.gdc-landing .searchbar .wrap{padding-left:1.2rem;padding-right:1.2rem}
}
.gdc-landing .searchfield{width:340px;max-width:100%;display:flex;align-items:center;gap:.6rem;padding:.7rem 1rem;background:#0c0c11;border:1px solid rgba(255,255,255,.14);border-radius:12px;transition:border-color .2s,box-shadow .2s}
.gdc-landing .searchfield:focus-within{border-color:var(--neon);box-shadow:0 0 0 4px rgba(0,245,196,.1)}
.gdc-landing .searchfield svg{width:18px;height:18px;stroke:var(--faint);fill:none;flex-shrink:0}
.gdc-landing .searchfield input{flex:1;background:none;border:none;outline:none;color:var(--ink);font-family:var(--body);font-size:.95rem;min-width:0}
.gdc-landing .searchfield input::placeholder{color:var(--faint)}
.gdc-landing .searchfield input:-webkit-autofill, .gdc-landing .searchfield input:-webkit-autofill:hover, .gdc-landing .searchfield input:-webkit-autofill:focus, .gdc-landing .searchfield input:-webkit-autofill:active{-webkit-text-fill-color:var(--ink);-webkit-box-shadow:0 0 0 1000px #0c0c11 inset;caret-color:var(--ink);transition:background-color 9999s ease-in-out 0s}
.gdc-landing .searchfield .flagpick{flex-shrink:0;display:inline-flex;align-items:center;gap:3px;cursor:pointer;position:relative}
.gdc-landing .searchfield .flagcur{font-size:1.05rem;line-height:1}
.gdc-landing .searchfield .flagcaret{width:10px;height:7px;color:var(--faint);flex-shrink:0}
.gdc-landing .searchfield .flagsel{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:0;-webkit-appearance:none;appearance:none}
.gdc-landing .searchfield .flagsel option{background:#0c0c11;color:var(--ink);font-size:1rem}
.gdc-landing .searchbtn{flex-shrink:0;width:46px;height:46px;display:flex;align-items:center;justify-content:center;background:#0c0c11;border:1px solid var(--neon);border-radius:12px;cursor:pointer}
.gdc-landing .searchbtn svg{width:18px;height:18px;stroke:var(--neon);fill:none}`;

const LANDING_BODY = String.raw`

<div class="searchbar">
  <div class="wrap">
    <form class="searchfield" role="search" onsubmit="var q=this.q.value.trim();location.href='/djs'+(q?('?q='+encodeURIComponent(q)):'');return false;">
      <svg viewBox="0 0 24 24" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input type="text" name="q" placeholder="Search by zip or DJ name…" aria-label="Search by zip or DJ name">
      <label class="flagpick" aria-label="Country">
        <span class="flagcur">🇺🇸</span>
        <svg class="flagcaret" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
        <select class="flagsel" name="cc" onchange="this.closest('.flagpick').querySelector('.flagcur').textContent=this.selectedOptions[0].text.trim().split(' ')[0]">
          <option value="us">🇺🇸 United States</option>
          <option value="gb">🇬🇧 United Kingdom</option>
          <option value="ca">🇨🇦 Canada</option>
          <option value="au">🇦🇺 Australia</option>
          <option value="de">🇩🇪 Germany</option>
          <option value="fr">🇫🇷 France</option>
          <option value="nl">🇳🇱 Netherlands</option>
          <option value="es">🇪🇸 Spain</option>
          <option value="it">🇮🇹 Italy</option>
          <option value="br">🇧🇷 Brazil</option>
          <option value="mx">🇲🇽 Mexico</option>
          <option value="jp">🇯🇵 Japan</option>
          <option value="za">🇿🇦 South Africa</option>
          <option value="nz">🇳🇿 New Zealand</option>
          <option value="ie">🇮🇪 Ireland</option>
          <option value="se">🇸🇪 Sweden</option>
          <option value="no">🇳🇴 Norway</option>
          <option value="dk">🇩🇰 Denmark</option>
          <option value="be">🇧🇪 Belgium</option>
          <option value="ch">🇨🇭 Switzerland</option>
          <option value="pt">🇵🇹 Portugal</option>
        </select>
      </label>
    </form>
    <button class="searchbtn" type="button" aria-label="Use my location" onclick="if(navigator.geolocation){this.style.opacity='.5';navigator.geolocation.getCurrentPosition(function(p){location.href='/djs?lat='+p.coords.latitude+'&lng='+p.coords.longitude;},function(){location.href='/djs?near=1';});}else{location.href='/djs?near=1';}">
      <svg viewBox="0 0 24 24" stroke-width="2"><path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
    </button>
  </div>
</div>

<!-- HERO (DJ-first) -->
<section class="hero">
  <div class="hero-bg"></div>
  <div class="wrap herogrid">
    <div>
      <div class="label">Built for working DJs</div>
      <h1>THE <span class="a">ENTIRE BOOKING PROCESS</span> IN ONE PLATFORM</h1>
      <p class="lede">Global DJ Connect turns the booking process into one link or QR code you share with clients — instant quotes, contracts and deposits handled, money straight to your account. <b class="hl">0% platform cut.</b></p>
      <div class="hero-cta">
        <a class="btn btn-neon" href="#">Create your DJ page →</a>
        <a class="btn btn-ghost" href="#how">See how it works</a>
      </div>
    </div>
  </div>
</section>

<div class="stepbar">
  <div class="wrap"><div class="hero-steps"><b>Create a DJ profile</b><i>→</i><b>Enter your rates &amp; details</b><i>→</i><b>Get booked</b></div></div>
</div>

<!-- TWO DJ TYPES + THEIR PIPELINES -->
<section id="built">
  <div class="wrap">
    <div class="shead reveal">
      <div class="label">Choose your lane</div>
      <h2>TWO SEPARATE BOOKING FLOWS</h2>
      <p>Pick the flow for the type of DJ you are. <span style="color:var(--neon);font-weight:600">Mobile DJs</span> book events via packages, while <span style="color:var(--amber);font-weight:600">Club/Bar DJs</span> book with specific equipment requirements and a choice of flat or hourly rate.</p>
    </div>
    <div class="flowcards reveal">
      <div class="flane mobile">
        <div class="fh">Mobile DJs<small>Booking Process</small><a class="fhbtn" href="/signup?type=dj&amp;dj=mobile">Sign Up</a></div>
        <div class="fli"><span class="smk">Step</span><div>Host selects date, time &amp; venue. The packages display and rates calculate. The host selects a package. The booking request is sent to you for a decision. <a class="viewsample" onclick="openLB('lbMobile')">Booking request sample</a></div></div>
        <div class="fli"><span class="smk">Step</span>You approve or deny the request</div>
        <div class="fli"><span class="smk">Step</span>Contract selected, signed &amp; sent</div>
        <div class="fli"><span class="smk">Step</span>Request deposit to lock in the date</div>
        <div class="fli"><span class="smk">Step</span>Planner &amp; playlist sent to the host</div>
        <div class="fli"><span class="smk">Step</span>Invoice internally generated and sent at your discretion</div>
        <div class="fli topalign"><span class="smk">Step</span>Receipt auto‑sent once invoice is marked paid</div>
      </div>
      <div class="flane club">
        <div class="fh">Club / Bar DJs<small>Booking Process</small><a class="fhbtn" href="/signup?type=dj&amp;dj=club">Sign Up</a></div>
        <div class="fli"><span class="smk">Step</span><div>Host / promoter selects a date and equipment option. The rate is calculated and the booking request is sent to you for decision <a class="viewsample" onclick="openLB('lbClub')">Booking request sample</a></div></div>
        <div class="fli"><span class="smk">Step</span>You approve, deny, or counter‑offer the request</div>
        <div class="fli"><span class="smk">Step</span>Contract selected, signed &amp; sent</div>
        <div class="fli"><span class="smk">Step</span>Rider sent to host / promoter</div>
        <div class="fli"><span class="smk">Step</span>Guest list collected for the night</div>
        <div class="fli"><span class="smk">Step</span>Invoice internally generated and sent at your discretion</div>
        <div class="fli topalign"><span class="smk">Step</span><div>Receipt auto‑sent once invoice is marked paid<div class="finote">Deposit can be added to the booking pipeline but typically not required for club/bar bookings.</div></div></div>
      </div>
    </div>
    <p class="types-note reveal">Every step in the booking pipeline can be customized to fit your need. Turn any of the steps on or off in your booking settings.</p>
  </div>
</section>

<!-- BOOKING DASHBOARD SAMPLE (interactive) -->
<section id="dashsample" style="padding:56px 0 24px">
  <link rel="stylesheet" href="/booking-dashboard.css">
  <div class="wrap">
    <div class="shead reveal">
      <div class="label">See how the pipeline works</div>
      <h2>YOUR BOOKING DASHBOARD</h2>
      <p>Below is a sample of how two bookings look in your booking dashboard. The icons are used to deploy everything needed during the booking process — keeping you organized with up-to-the-moment status on each item in the pipeline.</p>
    </div>
    <div class="gdc-dash">
      <div id="gdc-dash-mount"></div>
      <div class="resetbar"><button class="reset" onclick="resetAll()">↻ Reset sample</button></div>
    </div>
  </div>
</section>

<!-- FEATURES -->
<section id="features">
  <div class="wrap">
    <div class="shead reveal">
      <div class="label">The platform</div>
      <h2>EVERYTHING NEEDED FROM START TO FINISH</h2>
      <p>Global DJ Connect replaces the DMs, spreadsheets, invoices and chasing. The features below can be customized or excluded to your liking in the booking settings.</p>
    </div>
    <div class="flist">
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084816_351e51b1-cf96-42a8-ae49-b8f568baabea.png" alt=""><h3>DJ Profile</h3><p>Your public profile is your home base on Global DJ Connect — it can be accessed via QR code, URL link, or found through search of the website. Add photos, bio, mixes, video, and social media links to give potential hosts the best understanding of what you have to offer their event. The booking calendar is the centerpiece of the profile, and a host/promoter can send a booking request with one click.</p></div>
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084816_351e51b1-cf96-42a8-ae49-b8f568baabea.png" alt=""><h3>Instant quotes</h3><p>Host picks event type, date, time and venue, and your pricing builds the quote automatically — the details and quote are then sent to you for approval. Prefer not to display prices? Turn on "request a price" instead: the host enters their info and selects their requirements, and a booking request is emailed to you to add a price.</p></div>
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260902_073219_a8d7f0f0-f682-4cf4-9414-a8e7a82d39ea.png" alt=""><h3>Contracts &amp; e‑sign</h3><p>Built‑in e‑sign system. Upload your own contract and set the fields once — with each booking, our system auto‑populates the booking's details onto the contract, ready for you to approve and send in one click. No contract? Work off Global DJ Connect's pre‑built contracts. Once signed, both parties are emailed a copy.</p></div>
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084816_9832a838-15f6-4770-be32-2edcc0b10107.png" alt=""><h3>Deposits</h3><p>Set the deposit % you require in booking settings. Global DJ Connect calculates the deposit for each booking — click Request Deposit in your dashboard and the host is emailed a request with every payment option you accept.</p></div>
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084816_6dbc45c3-62c6-49e3-b040-e63dca786535.png" alt=""><h3>Get paid</h3><p>We don't middle‑man your deposits or balances. Money is sent directly to your account and we never take a % of the transaction. Note: depending on the method, the payment processor may charge its own transaction fee.<span class="paylist"><b class="pm-stripe">Credit card</b><i>·</i><b class="pm-paypal">PayPal</b><i>·</i><b class="pm-venmo">Venmo</b><i>·</i><b class="pm-cashapp">Cash App</b><i>·</i><b class="pm-check">Check</b><i>·</i><b class="pm-cash">Cash</b></span></p></div>
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084816_351e51b1-cf96-42a8-ae49-b8f568baabea.png" alt=""><h3>Manual booking</h3><p>Booked a gig off‑platform? Add it with one click — enter the date, venue and rate and it drops alongside your online bookings. From there you can add the host's email, send a contract, request a deposit, invoice. The manual booking will act just as a normal booking through the platform.</p></div>
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_090555_9783c217-7752-446f-b96e-871e543cdac6.png" alt=""><h3>Discounts &amp; promo codes</h3><p>Create promo codes with a % off or exact dollar amount, or set a site‑wide % discount off all bookings. Includes an exclusion option for select dates (e.g. New Year's Eve).</p></div>
      <div class="r reveal framed"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084917_664ddc37-4986-4420-ab8e-10d1889ac023.png" alt=""><div class="titlecol"><span class="tg mobile">Mobile DJ only</span><h3>Planner &amp; playlist</h3></div><p>Customize a planner for each event and send it with one click for all future events. It auto‑saves the moment the host starts filling it in, so they don't have to do it all at once. Track the total % complete to the minute from your booking dashboard, and send a reminder email any time.</p></div>
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084816_9832a838-15f6-4770-be32-2edcc0b10107.png" alt=""><h3>Invoicing</h3><p>The balance is auto‑calculated after the deposit and invoiced to the host in one click. Once it's marked paid, a receipt is emailed to the host automatically. <b>For mobile DJs:</b> if overtime is added to your event, you can invoice it separately — a total receipt covering the event and the overtime is sent once it's marked paid.</p></div>
      <div class="r reveal framed-amber"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084816_83fb9f5b-de14-4737-9b42-a37962810cd2.png" alt=""><div class="titlecol"><span class="tg club">Club/Bar DJ only</span><h3>Rider</h3></div><p>Send the host / promoter your technical &amp; hospitality rider. Customize it within Global DJ Connect, or upload a pre‑made rider — either way it sends straight through Global DJ Connect.</p></div>
      <div class="r reveal framed-amber"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084816_27083888-d22d-4bb4-9149-ef297714a195.png" alt=""><div class="titlecol"><span class="tg club">Club/Bar DJ only</span><h3>Guest list</h3></div><p>Add and sort the guest list, then send it to the host through Global DJ Connect so they can confirm names have been approved.</p></div>
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084816_d83ad708-0d07-45a7-ba99-fb6fdbc21b09.png" alt=""><h3>Calendar sync</h3><p>Connect all bookings to your Google or Apple calendar with "Sync to Calendar." Once synced, all existing and future bookings are added to your calendar automatically.</p></div>
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084816_d83ad708-0d07-45a7-ba99-fb6fdbc21b09.png" alt=""><h3>Embed calendar</h3><p>Embed your live availability calendar on your own website — clients see your open and booked dates in real time.</p></div>
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260830_083159_d9cea88f-a41f-45fd-88eb-92c421afd6eb.png" alt=""><h3>Team</h3><p>Give authorized personnel access to your Global DJ Connect account with separate logins and role‑based restrictions — Assistant, Manager, or Admin. <a class="samplelink" onclick="openLB('lbTeamMobile')">Mobile DJ account sample</a> · <a class="samplelink club" onclick="openLB('lbTeamClub')">Club/Bar DJ account sample</a></p></div>
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084816_85726c22-c72e-478d-9d61-4f1981265900.png" alt=""><h3>SMS &amp; Email</h3><p>By default every request sends an email update; opt in for SMS notifications as a secondary reminder.</p></div>
      <div class="r reveal"><img loading="lazy" decoding="async" src="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_084816_9832a838-15f6-4770-be32-2edcc0b10107.png" alt=""><h3>Past bookings</h3><p>Every completed event moves to your past bookings, keeping a full record — contract, planner or rider, guest list, and receipts all stay attached. Re‑download any document, invoice overtime after the fact, or reference past details when a repeat client books again.</p></div>
    </div>
  </div>
</section>

<!-- HOW IT WORKS (text) -->
<section id="how">
  <div class="wrap">
    <div class="shead reveal">
      <div class="label">How it works</div>
      <h2>ACCOUNT SETUP STEPS</h2>
      <p>Whether you’re a mobile or club/bar DJ, you’re live in minutes.</p>
    </div>
    <div class="howgrid reveal">
      <div class="howcol mobile">
        <h3 class="howh">Mobile DJ</h3>
        <div class="howstep"><div class="num">1</div><div class="t">Create your profile</div></div>
        <div class="howstep"><div class="num">2</div><div class="t">Edit your booking settings</div></div>
        <div class="howstep"><div class="num">3</div><div class="t">Add your packages &amp; prices</div></div>
        <div class="howstep"><div class="num">4</div><div class="t">Add your contract — or use ours</div></div>
        <div class="howstep"><div class="num">5</div><div class="t">Add the payment methods you accept</div></div>
        <div class="howstep"><div class="num">6</div><div class="t">Set up your planner &amp; playlist templates</div></div>
        <div class="hownote">Total setup takes <b>10–12 minutes</b>. Once everything’s set up, bookings, contracts, planners &amp; invoices are as simple as a click of the mouse.</div>
      </div>
      <div class="howcol club">
        <h3 class="howh">Club · Bar DJ</h3>
        <div class="howstep"><div class="num">1</div><div class="t">Create your profile</div></div>
        <div class="howstep"><div class="num">2</div><div class="t">Edit your booking settings</div></div>
        <div class="howstep"><div class="num">3</div><div class="t">Add the equipment you require or are willing to supply</div></div>
        <div class="howstep"><div class="num">4</div><div class="t">Select your rate type — Flat Rate or Hourly — and add your rates</div></div>
        <div class="howstep"><div class="num">5</div><div class="t">Add your contract — or use ours <span class="optional">(optional)</span></div></div>
        <div class="howstep"><div class="num">6</div><div class="t">Add your rider <span class="optional">(optional)</span></div></div>
        <div class="hownote">Fewer steps — most club &amp; bar DJs are live in under <b>10 minutes</b>.</div>
      </div>
    </div>
  </div>
</section>

<!-- PRICING -->
<section id="pricing">
  <div class="wrap">
    <div class="shead reveal">
      <div class="label">Pricing</div>
      <h2>CREATE A FREE DJ PROFILE</h2>
      <p>You only pay your card processor's normal fee — we never take a percentage of what you earn. Yearly billing = 2 months free.</p>
    </div>
    <div class="price">
      <div class="plan reveal">
        <div class="pn">Free</div><div class="amt">$0<span> / mo</span></div>
        <div class="yr">&nbsp;</div>
        <ul>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Profile &amp; directory listing</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Shareable profile link</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> 4 photos · 1 video · 1 mix</li>
          <li class="no">No bookings, quotes or contracts</li>
        </ul>
        <a class="btn btn-ghost" href="#">Get started</a>
      </div>
      <div class="plan reveal">
        <div class="pn">Starter</div><div class="amt">$14.99<span> / mo</span></div>
        <div class="yr">or $149.90 / yr</div>
        <ul>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Everything in Free, plus:</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Booking engine &amp; instant quotes</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Deposits &amp; payments (0% cut)</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Contracts &amp; e‑sign — 5 / mo</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Planner, rider &amp; guest list</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Discounts &amp; promo codes</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Calendar sync + SMS &amp; email</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Profile QR code</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> 10 photos · 3 videos · 3 mixes</li>
          <li class="no">No embed calendar or team seats</li>
        </ul>
        <a class="btn btn-ghost" href="#">Choose Starter</a>
      </div>
      <div class="plan pro reveal">
        <span class="best">Most popular</span>
        <div class="pn">Pro</div><div class="amt">$29.99<span> / mo</span></div>
        <div class="yr">or $299.90 / yr</div>
        <ul>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Everything in Starter, plus:</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Embed calendar (live availability)</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Team — 2 seats &amp; roles</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Contracts &amp; e‑sign — 30 / mo</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> 25 photos · 6 videos · 6 mixes</li>
        </ul>
        <a class="btn btn-neon" href="#">Choose Pro</a>
      </div>
      <div class="plan reveal">
        <div class="pn">Premium Pro</div><div class="amt">$49.99<span> / mo</span></div>
        <div class="yr">or $499.90 / yr</div>
        <ul>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Everything in Pro, plus:</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Contracts &amp; e‑sign — 100 / mo</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Team — 5 seats</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> 50 photos · 10 videos · 10 mixes</li>
        </ul>
        <a class="btn btn-ghost" href="#">Choose Premium Pro</a>
      </div>
      <div class="plan reveal">
        <div class="pn">Enterprise</div><div class="amt">$99.99<span> / mo</span></div>
        <div class="yr">or $999.90 / yr</div>
        <ul>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Everything in Premium Pro, plus:</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Contracts &amp; e‑sign — 250 / mo</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> Team — 15 seats</li>
          <li><svg viewBox="0 0 24 24" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg> 100 photos · 20 videos · 20 mixes</li>
        </ul>
        <a class="btn btn-ghost" href="#">Choose Enterprise</a>
      </div>
    </div>
  </div>
</section>




<!-- HOST PREVIEW LIGHTBOXES -->
<div class="lb" id="lbMobile" onclick="if(event.target===this)closeLB('lbMobile')">
  <div class="sheet">
    <button class="x" type="button" onclick="closeLB('lbMobile')" aria-label="Close">×</button>
    <div class="hp">
      <div class="ey">Booking request</div>
      <div class="t">Saturday, August 15, 2026</div>
      <div class="demo"><b>Interactive sample</b> — this is exactly what a host fills out</div>

      <label class="lb2">Your name</label>
      <div class="fld">Jane Doe</div>

      <label class="lb2">Phone number</label>
      <div class="fld">(917) 555-0142</div>

      <label class="lb2">Type of event</label>
      <select class="selin" id="mEvent">
        <option data-s="0">Anniversary</option>
        <option data-s="0">Wedding</option>
        <option data-s="0">Birthday</option>
        <option data-s="50">Sweet 16</option>
        <option data-s="100">Corporate event</option>
        <option data-s="75">Holiday party</option>
      </select>

      <label class="lb2">Venue name</label>
      <div class="fld">The Grand Ballroom</div>

      <label class="lb2">Venue address</label>
      <div class="addr"><div class="sel">🇺🇸&nbsp;US</div><div class="fld">123 Celebration Ave, Staten Island, NY</div></div>

      <label class="lb2">Room details <i>(optional)</i></label>
      <div class="fld">Main Hall</div>

      <label class="lb2">Estimated number of guests</label>
      <div class="fld stepper"><span>150</span><span class="ar">▲<br>▼</span></div>

      <div class="two" style="margin-top:.4rem">
        <div><label class="lb2" id="lblStart" style="margin-top:0">Event start time</label>
          <select class="selin" id="mStart">
            <option value="16">4:00 PM</option><option value="17">5:00 PM</option>
            <option value="18" selected>6:00 PM</option><option value="19">7:00 PM</option>
            <option value="20">8:00 PM</option><option value="21">9:00 PM</option>
          </select></div>
        <div><label class="lb2" id="lblEnd" style="margin-top:0">Event end time</label>
          <select class="selin" id="mEnd">
            <option value="21">9:00 PM</option><option value="22">10:00 PM</option>
            <option value="23" selected>11:00 PM</option><option value="24">12:00 AM</option>
            <option value="25">1:00 AM</option><option value="26">2:00 AM</option>
          </select></div>
      </div>

      <div id="wedOpts" style="display:none">
        <div class="wcard" id="wCocktail">
          <div class="wey">Cocktail hour</div>
          <div class="wq">Is music needed for cocktail hour?</div>
          <div class="wyn main"><button type="button" class="wy" onclick="wYN('wCocktail',1)">YES</button><button type="button" class="wn on" onclick="wYN('wCocktail',0)">NO</button></div>
          <div class="wsub" id="wCocktailSub" style="display:none">
            <label class="lb2">Cocktail start time</label>
            <select class="selin" onchange="this.classList.toggle('filled',this.selectedIndex>0)"><option>Select time…</option><option>4:00 PM</option><option>4:30 PM</option><option>5:00 PM</option><option>5:30 PM</option></select>
            <div class="wq" style="margin-top:.9rem">Is the cocktail hour in the same room as the reception?</div>
            <div class="wyn"><button type="button" class="wy on" onclick="togBtn(this)">YES</button><button type="button" class="wn" onclick="togBtn(this)">NO</button></div>
          </div>
        </div>
        <div class="wcard" id="wCeremony">
          <div class="wey">Music for ceremony</div>
          <div class="wq">Is music needed for the ceremony?</div>
          <div class="wyn main"><button type="button" class="wy" onclick="wYN('wCeremony',1)">YES</button><button type="button" class="wn on" onclick="wYN('wCeremony',0)">NO</button></div>
          <div class="wsub" id="wCeremonySub" style="display:none">
            <label class="lb2">Ceremony start time</label>
            <select class="selin" onchange="this.classList.toggle('filled',this.selectedIndex>0)"><option>Select time…</option><option>3:00 PM</option><option>3:30 PM</option><option>4:00 PM</option><option>4:30 PM</option></select>
            <div class="wq" style="margin-top:.9rem">Is the ceremony in the same room as the reception?</div>
            <div class="wyn"><button type="button" class="wy on" onclick="togBtn(this)">YES</button><button type="button" class="wn" onclick="togBtn(this)">NO</button></div>
          </div>
        </div>
      </div>

      <label class="lb2">Available packages <span class="val" style="font-weight:400;color:#8a8a94;font-size:.62rem">tap to choose</span></label>
      <div class="pkgbox on" id="pkGold" onclick="selPkg('gold')">
        <div class="pkghd"><span>Gold Package</span> <span class="pkr"><span class="chk">✓ Selected</span><b id="bGold">$600</b></span></div>
        <ul class="pkgli"><li>Full PA &amp; lighting rig</li><li>MC &amp; live requests</li><li>Dance-floor lighting</li><li>Setup &amp; breakdown</li></ul>
      </div>
      <div class="pkgbox" id="pkSilver" onclick="selPkg('silver')">
        <div class="pkghd"><span>Silver Package</span> <span class="pkr"><span class="chk">✓ Selected</span><b id="bSilver">$450</b></span></div>
        <ul class="pkgli"><li>PA system</li><li>MC &amp; live requests</li><li>Setup &amp; breakdown</li></ul>
      </div>
      <div class="quote">
        <div class="ln"><span>Subtotal</span><span id="qSub">$600.00</span></div>
        <div class="ln"><span>Tax (8.875%)</span><span id="qTax">$53.25</span></div>
        <div class="ln tot"><span>Total</span><span id="qTot">$653.25</span></div>
        <div class="ln"><span>Deposit due now (15%)</span><span id="qDep">$97.99</span></div>
        <div class="ln bal"><span>Balance day of event</span><span id="qBal">$555.26</span></div>
      </div>

      <label class="lb2">Message <i>(optional)</i></label>
      <div class="fld">Celebrating our 25th — looking for an upbeat mix.</div>
      <button class="submit" type="button">Send booking request</button>
    </div>
  </div>
</div>
<div class="lb" id="lbClub" onclick="if(event.target===this)closeLB('lbClub')">
  <div class="sheet">
    <button class="x" type="button" onclick="closeLB('lbClub')" aria-label="Close">×</button>
    <div class="hp amber">
      <div class="ey">Booking request</div>
      <div class="t">Saturday, November 2, 2026</div>
      <div class="demo"><b>Interactive sample</b> — this is exactly what a promoter fills out</div>

      <label class="lb2">Your name</label>
      <div class="fld">Alex Rivera</div>

      <label class="lb2">Phone number <span class="val">(917) 555-2020</span></label>

      <label class="lb2">Event type</label>
      <div class="pills3"><div class="pill" onclick="selPill(this)">Bar</div><div class="pill on" onclick="selPill(this)">Club</div><div class="pill" onclick="selPill(this)">Other</div></div>

      <label class="lb2">Set type</label>
      <select class="selin">
        <option>Opening Set</option>
        <option selected>Headliner</option>
        <option>Closing Set</option>
        <option>Opening – Close</option>
        <option>Opening &amp; Closing</option>
      </select>

      <label class="lb2">Venue</label>
      <div class="fld">Neon Room</div>
      <div class="addr2" style="margin-top:8px"><div class="fld">88 Downtown Ave, New York, NY</div><div class="sel">🇺🇸&nbsp;US</div></div>

      <label class="lb2">Set times</label>
      <div class="two">
        <div><label class="lb2" style="margin-top:0;color:var(--faint)">Set start</label>
          <select class="selin" id="cStart" onchange="calcClub()">
            <option value="20">8:00 PM</option><option value="21">9:00 PM</option>
            <option value="22" selected>10:00 PM</option><option value="23">11:00 PM</option>
            <option value="24">12:00 AM</option>
          </select></div>
        <div><label class="lb2" style="margin-top:0;color:var(--faint)">Set end</label>
          <select class="selin" id="cEnd" onchange="calcClub()">
            <option value="24">12:00 AM</option><option value="25">1:00 AM</option>
            <option value="26" selected>2:00 AM</option><option value="27">3:00 AM</option>
            <option value="28">4:00 AM</option>
          </select></div>
      </div>

      <label class="lb2">Equipment for venue</label>
      <div class="eq" data-rate="na" onclick="selEq(this)">DJ Provides System + Decks</div>
      <div class="eq" data-rate="375" onclick="selEq(this)">DJ Provides Decks</div>
      <div class="eq on" data-rate="300" onclick="selEq(this)">Venue Provides All</div>

      <label class="lb2">Rate</label>
      <div class="rate" id="cRate">
        <div class="ln"><span id="cHrsLbl">4-hour set</span><span id="cHrs">$1,200.00</span></div>
        <div class="ln tot"><span>Total</span><span id="cTot">$1,200.00</span></div>
        <div class="ln bal"><span>Due night of event</span><span id="cBal">$1,200.00</span></div>
      </div>
      <div class="rate-na" id="cNA" style="display:none">This DJ doesn't accept bookings with this equipment option.</div>

      <label class="lb2">Notes <i>(optional)</i></label>
      <div class="fld">Saturday headline slot — open format, high energy.</div>
      <button class="submit" type="button">Send booking request</button>
    </div>
  </div>
</div>
<div class="lb" id="lbTeamMobile" onclick="if(event.target===this)closeLB('lbTeamMobile')">
  <div class="sheet">
    <button class="x" type="button" onclick="closeLB('lbTeamMobile')" aria-label="Close">×</button>
    <div class="rolewrap">
      <div class="rolehd">What each role can do <small style="font-family:var(--mono);font-size:.55rem;letter-spacing:.12em;color:var(--neon);text-transform:uppercase">· Mobile</small></div>
      <table class="roletbl">
        <tr><th class="lbl"></th><th>Admin</th><th>Manager</th><th>Assistant</th></tr>
        <tr><td class="lbl">View bookings</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
        <tr><td class="lbl">Send planner &amp; playlist</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
        <tr><td class="lbl">Send invoices</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
        <tr><td class="lbl">Accept or deny bookings</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">✕</td></tr>
        <tr><td class="lbl">Send &amp; sign contracts</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">✕</td></tr>
        <tr><td class="lbl">Request deposits</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">✕</td></tr>
        <tr><td class="lbl">Manage team (invite &amp; remove staff)</td><td class="yes">✓</td><td class="no">✕</td><td class="no">✕</td></tr>
        <tr><td class="lbl">Change billing or booking settings</td><td class="no">✕</td><td class="no">✕</td><td class="no">✕</td></tr>
      </table>
      <div class="rolenote">Only you (the Owner) control billing, the subscription, and booking settings.</div>
    </div>
  </div>
</div>
<div class="lb" id="lbTeamClub" onclick="if(event.target===this)closeLB('lbTeamClub')">
  <div class="sheet">
    <button class="x" type="button" onclick="closeLB('lbTeamClub')" aria-label="Close">×</button>
    <div class="rolewrap">
      <div class="rolehd">What each role can do <small style="font-family:var(--mono);font-size:.55rem;letter-spacing:.12em;color:var(--amber);text-transform:uppercase">· Club / Bar</small></div>
      <table class="roletbl club">
        <tr><th class="lbl"></th><th>Admin</th><th>Manager</th><th>Assistant</th></tr>
        <tr><td class="lbl">View bookings</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
        <tr><td class="lbl">Update flyer, send riders &amp; guest lists</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
        <tr><td class="lbl">Send invoices</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
        <tr><td class="lbl">Accept, deny or counter bookings</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">✕</td></tr>
        <tr><td class="lbl">Send &amp; sign contracts</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">✕</td></tr>
        <tr><td class="lbl">Request deposits</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">✕</td></tr>
        <tr><td class="lbl">Manage team (invite &amp; remove staff)</td><td class="yes">✓</td><td class="no">✕</td><td class="no">✕</td></tr>
        <tr><td class="lbl">Change billing or booking settings</td><td class="no">✕</td><td class="no">✕</td><td class="no">✕</td></tr>
      </table>
      <div class="rolenote">Only you (the Owner) control billing, the subscription, and booking settings.</div>
    </div>
  </div>
</div>

`;

const LANDING_SCRIPT = String.raw`
function openLB(id){var e=document.getElementById(id);if(e){e.classList.add('open');document.body.style.overflow='hidden';}}
function closeLB(id){var e=document.getElementById(id);if(e){e.classList.remove('open');document.body.style.overflow='';}}
document.addEventListener('keydown',function(e){if(e.key==='Escape'){document.querySelectorAll('.lb.open').forEach(function(l){l.classList.remove('open');});document.body.style.overflow='';}});
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}})},{threshold:.12});
document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});

// HOW IT WORKS — text toggle (Mobile default)
(function(){
  var card=document.getElementById('howCard'); if(!card) return;
  var DATA={
    mobile:{steps:['Create your profile','Edit your booking settings','Add your packages &amp; prices','Add your contract — or use ours','Add the payment methods you accept','Set up your planner &amp; playlist templates'],
      note:'Total setup takes <b>10–12 minutes</b>. Once everything’s set up, bookings, contracts, planners &amp; invoices are as simple as a click of the mouse.'},
    club:{steps:['Create your profile','Edit your booking settings','Add the equipment you require or are willing to supply','Add your rates','Add your contract — or use ours <span class="optional">(optional)</span>','Add your rider <span class="optional">(optional)</span>'],
      note:'Fewer steps — most club &amp; bar DJs are live in under <b>10 minutes</b>.'}
  };
  function renderHow(tab){
    var d=DATA[tab]||DATA.mobile;
    card.innerHTML=d.steps.map(function(s,i){return '<div class="howstep"><div class="num">'+(i+1)+'</div><div class="t">'+s+'</div></div>';}).join('')
      +'<div class="hownote">'+d.note+'</div>';
  }
  document.querySelectorAll('.howtab').forEach(function(b){b.onclick=function(){document.querySelectorAll('.howtab').forEach(function(x){x.classList.remove('on');});b.classList.add('on');renderHow(b.dataset.tab);};});
  renderHow('mobile');
})();

// Interactive sample quote (mobile "View sample")
(function(){
  var evt=document.getElementById('mEvent'), st=document.getElementById('mStart'), en=document.getElementById('mEnd');
  if(!evt) return;
  var pkg='gold', BASE={gold:600,silver:450}, INCLUDED=5, OT_RATE=100;
  function money(n){return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function whole(n){return '$'+n.toLocaleString('en-US');}
  function set(id,v){var e=document.getElementById(id); if(e)e.textContent=v;}
  window.selPkg=function(p){pkg=p;
    document.getElementById('pkGold').classList.toggle("on",p==="gold");
    document.getElementById('pkSilver').classList.toggle("on",p==="silver");
    calc();};
  var WED={wCocktail:200,wCeremony:150};
  window.togBtn=function(b){var g=b.parentNode;g.querySelectorAll('button').forEach(function(x){x.classList.remove('on');});b.classList.add('on');};
  window.wYN=function(id,yes){var c=document.getElementById(id);var m=c.querySelector('.wyn.main');
    m.querySelector('.wy').classList.toggle('on',!!yes);m.querySelector('.wn').classList.toggle('on',!yes);
    var sub=document.getElementById(id+'Sub');if(sub)sub.style.display=yes?'':'none';calc();};
  function calc(){
    var b=BASE[pkg];
    var opt=evt.options[evt.selectedIndex], surcharge=+(opt.getAttribute('data-s')||0);
    var isWed=opt.text==='Wedding';
    document.getElementById('wedOpts').style.display=isWed?'':'none';
    document.getElementById('lblStart').textContent=isWed?'Reception start time':'Event start time';
    document.getElementById('lblEnd').textContent=isWed?'Reception end time':'Event end time';
    var wed=0;
    if(isWed){for(var k in WED){var c=document.getElementById(k);if(c.querySelector('.wyn.main .wy').classList.contains('on'))wed+=WED[k];}}
    var hrs=Math.max(0,(+en.value)-(+st.value)), ot=Math.max(0,hrs-INCLUDED), otAmt=ot*OT_RATE;
    var addons=surcharge+otAmt+wed;
    set('bGold', whole(BASE.gold+addons)); set('bSilver', whole(BASE.silver+addons));
    var sub=b+addons, tax=sub*0.08875, tot=sub+tax, dep=tot*0.15, bal=tot-dep;
    set('qSub',money(sub)); set('qTax',money(tax)); set('qTot',money(tot)); set('qDep',money(dep)); set('qBal',money(bal));
  }
  evt.onchange=calc; st.onchange=calc; en.onchange=calc; calc();
})();

// Interactive sample rate (club/bar "Booking request sample")
(function(){
  var cs=document.getElementById('cStart'), ce=document.getElementById('cEnd');
  if(!cs) return;
  function money(n){return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function whole(n){return '$'+n.toLocaleString('en-US');}
  function set(id,v){var e=document.getElementById(id); if(e)e.textContent=v;}
  window.selEq=function(el){
    document.querySelectorAll('#lbClub .eq').forEach(function(x){x.classList.remove('on');});
    el.classList.add('on'); calcClub();
  };
  window.selPill=function(el){
    el.parentNode.querySelectorAll('.pill').forEach(function(x){x.classList.remove('on');});
    el.classList.add('on');
  };
  window.calcClub=function(){
    var sel=document.querySelector('#lbClub .eq.on');
    var raw=sel?sel.getAttribute('data-rate'):'300';
    var rate=document.getElementById('cRate'), na=document.getElementById('cNA');
    if(raw==='na'){ rate.style.display='none'; na.style.display=''; return; }
    rate.style.display=''; na.style.display='none';
    var hrs=Math.max(1,(+ce.value)-(+cs.value));
    var hourly=+raw||0, tot=hrs*hourly;
    set('cEst', whole(tot));
    set('cHrsLbl', hrs+'-hour set');
    set('cHrs', money(tot));
    set('cTot', money(tot)); set('cBal', money(tot));
  };
  calcClub();
})();

`;

export default function HomePage() {
  useEffect(() => {
    const s = document.createElement('script');
    s.textContent = LANDING_SCRIPT;
    document.body.appendChild(s);
    // Interactive booking-dashboard sample (its CSS + JS are static files in /public).
    const d = document.createElement('script');
    d.src = '/booking-dashboard.js';
    document.body.appendChild(d);
    return () => { s.remove(); d.remove(); };
  }, []);
  return (
    <>
      {/* Warm up the image CDN and fetch the hero background FIRST. It's a CSS
          background, so the browser only discovers it after parsing the injected
          <style> — by which point it was landing dead last in the waterfall and
          the hero sat black. Preloading it as an image hoists it to the top. */}
      <link rel="preconnect" href="https://d8j0ntlcm91z4.cloudfront.net" crossOrigin="" />
      <link
        rel="preload"
        as="image"
        href="https://d8j0ntlcm91z4.cloudfront.net/user_3I7KWF53YRk0UtD2aF2XnRfCPCI/hf_20260826_060736_6ca7550a-4c9d-4b3f-9589-1fdafe3da0a1.png"
        fetchPriority="high"
      />
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <div
        className={`gdc-landing ${fBebas.variable} ${fDmSans.variable} ${fSpaceMono.variable}`}
        dangerouslySetInnerHTML={{ __html: LANDING_BODY }}
      />
    </>
  );
}
