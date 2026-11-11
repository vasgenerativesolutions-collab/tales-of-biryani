import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import './reveal.js';

gsap.registerPlugin(ScrollTrigger);
// Mobile address bars resize the viewport while scrolling; don't recalculate
// the whole scroll timeline for that (it causes a visible jump at the start).
ScrollTrigger.config({ ignoreMobileResize: true });

const FRAME_COUNT = 190;
const FRAME_END = 0.78; // timeline point where the camera reaches the close-up
// Phones get the lighter 960px set: half the decode work, faster download.
const SMALL_SCREEN = Math.min(screen.width, screen.height) < 700;
const FRAME_DIR = SMALL_SCREEN ? 'frames-sm' : 'frames';
const frameSrc = (i) => `${import.meta.env.BASE_URL}${FRAME_DIR}/f_${String(i).padStart(3, '0')}.webp`;

const canvas = document.getElementById('bowl');
const ctx = canvas.getContext('2d');
const frames = [];
const state = { frame: 0, zoom: 1 };
let drawn = -1, drawnZoom = 1;

// ── Smooth scroll ────────────────────────────────────────
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lenis = reduceMotion ? null : new Lenis({ duration: 1.2, smoothWheel: true });
if (lenis) {
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

// ── Canvas ───────────────────────────────────────────────
let lastWidth = 0;
function resize() {
  // On touch devices the height changes as the address bar shows/hides.
  // Reallocating the canvas then flickers, so only react to width changes.
  if (SMALL_SCREEN && innerWidth === lastWidth) return;
  lastWidth = innerWidth;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  drawn = -1;
  draw();
}

function draw() {
  const i = Math.round(state.frame);
  const img = frames[i];
  if ((i === drawn && state.zoom === drawnZoom) || !img?.complete) return;
  drawn = i;
  drawnZoom = state.zoom;

  const cw = canvas.width, ch = canvas.height;
  const portrait = ch > cw;
  // Desktop: frame fills ~74% of the height.
  // Phone: the whole pot fits at the start (1.5x width); as the camera pushes in,
  // ease down to 1x so the close-up's soft oval edge stays on screen instead of
  // being cut into straight lines by the screen edges.
  // Never wider than the window: the close-up's soft oval must always fit, or
  // the window edges cut it into straight lines (narrow desktop windows too).
  const t = i / (FRAME_COUNT - 1);
  const fit = portrait ? (cw * (1.5 - 0.5 * t)) / img.width : Math.min((ch * 0.74) / img.height, cw / img.width);
  const scale = fit * state.zoom;
  const w = img.width * scale, h = img.height * scale;
  const cy = ch * (portrait ? 0.52 : 0.51);
  ctx.clearRect(0, 0, cw, ch); // frames are transparent cut-outs over the CSS backdrop
  ctx.drawImage(img, (cw - w) / 2, cy - h / 2, w, h);
}

// ── Text splitting ───────────────────────────────────────
function splitSlides(el) {
  el.setAttribute('aria-label', el.textContent);
  el.innerHTML = el.textContent
    .trim()
    .split(/\s+/)
    .map((w) => `<span class="slide" aria-hidden="true">${w}</span>`)
    .join(' ');
  return el.querySelectorAll('.slide');
}

function splitWords(el) {
  el.setAttribute('aria-label', el.textContent);
  el.innerHTML = el.textContent
    .trim()
    .split(/\s+/)
    .map((w) => `<span class="word" aria-hidden="true"><span>${w}</span></span>`)
    .join(' ');
  return el.querySelectorAll('.word > span');
}

// ── Scroll choreography ──────────────────────────────────
function buildTimeline() {
  const scene = (n) => document.querySelector(`[data-scene="${n}"]`);
  const heroWords = splitSlides(document.getElementById('heroTitle'));
  const mid = (heroWords.length - 1) / 2;

  const tl = gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: {
      trigger: '.scroll-track',
      start: 'top top',
      end: 'bottom bottom',
      scrub: 1,
    },
  });

  // Camera: orbit + push-in on the pot, linear with scroll.
  tl.to(state, { frame: FRAME_COUNT - 1, ease: 'none', duration: FRAME_END, onUpdate: draw }, 0);

  // Scene 1: headline words part sideways as the camera moves in.
  tl.to(scene(1).querySelector('.scene__foot'), { autoAlpha: 0, y: 30, duration: 0.06 }, 0.02);
  tl.to(heroWords, {
    xPercent: (i) => (i < mid ? -1 : 1) * 70,
    autoAlpha: 0,
    duration: 0.12,
  }, 0.03);
  tl.set(scene(1), { autoAlpha: 0 }, 0.17);

  // Scenes 2-4 — headline words rise from a mask, copy fades up.
  const reveal = (n, inAt, outAt, extra) => {
    const s = scene(n);
    const words = [...s.querySelectorAll('.reveal')].flatMap((h) => [...splitWords(h)]);
    const fades = s.querySelectorAll('.reveal-fade');
    tl.set(s, { autoAlpha: 1 }, inAt);
    tl.fromTo(words, { yPercent: 110 }, { yPercent: 0, duration: 0.07, stagger: 0.012 }, inAt);
    if (fades.length) tl.fromTo(fades, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.06, stagger: 0.015 }, inAt + 0.03);
    extra?.(s);
    if (outAt != null) {
      tl.to(words, { yPercent: -110, duration: 0.05, stagger: 0.008 }, outAt);
      if (fades.length) tl.to(fades, { autoAlpha: 0, y: -16, duration: 0.04 }, outAt);
      tl.set(s, { autoAlpha: 0 }, outAt + 0.06);
    }
  };

  reveal(2, 0.18, 0.36);
  reveal(3, 0.43, 0.66, (s) => {
    const badges = s.querySelectorAll('.badge');
    tl.fromTo(badges, { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 1, scale: 1, duration: 0.05, stagger: 0.02, ease: 'back.out(1.6)' }, 0.48);
    tl.to(badges, { autoAlpha: 0, scale: 0.85, duration: 0.04, stagger: 0.01 }, 0.65);
  });
  // Scene 4: the bowl steps back so the heading and buttons frame it, not cover it.
  // Zoom is applied inside draw(), not by scaling the canvas element: scaling the
  // element shrinks its edges into view as hard straight lines.
  tl.to(state, { zoom: 0.72, duration: 0.08, onUpdate: draw }, 0.76);
  reveal(4, 0.8, null);
  // Floating Order now and Auto-scroll give way to scene 4's own buttons.
  tl.to('.order-fab, .autoplay', { autoAlpha: 0, y: 20, duration: 0.04 }, 0.77);

  return tl;
}

// ── Auto-scroll: play the story hands-free ───────────────
const AUTOPLAY_MS = 24000; // whole story, top to bottom, at an even pace

function wireAutoplay(tl) {
  const btn = document.querySelector('.autoplay');
  const label = btn.querySelector('.autoplay__label');
  const st = tl.scrollTrigger;
  let raf = 0, last = 0, y = 0;

  const current = () => (lenis ? lenis.scroll : scrollY);
  const scrollToY = (v) => (lenis ? lenis.scrollTo(v, { immediate: true, force: true }) : scrollTo(0, v));
  const setOn = (on) => {
    btn.setAttribute('aria-pressed', String(on));
    label.textContent = on ? 'Pause' : 'Auto-scroll';
    btn.setAttribute('aria-label', on ? 'Pause auto-scroll' : 'Auto-scroll through the story');
  };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; setOn(false); };

  function step(now) {
    const speed = (st.end - st.start) / AUTOPLAY_MS; // px per ms
    y = Math.min(y + speed * Math.min(now - last, 64), st.end); // cap dt after a stalled frame
    last = now;
    scrollToY(y);
    if (y >= st.end) return stop();
    raf = requestAnimationFrame(step);
  }

  btn.addEventListener('click', () => {
    if (raf) return stop();
    y = current() >= st.end - 2 ? st.start : current(); // at the end: replay from the top
    if (y !== current()) scrollToY(y);
    last = performance.now();
    setOn(true);
    raf = requestAnimationFrame(step);
  });

  // The user always wins: any manual scroll, touch or key press stops it.
  const userInput = (e) => { if (raf && !btn.contains(e.target)) stop(); };
  for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
    addEventListener(type, userInput, { passive: true });
  }
  setOn(false);
}

// ── Home: solid header once the content scrolls under it ──
function wireHeader() {
  const header = document.querySelector('.header');
  // Solid from the moment the content reaches the header, until you scroll back up
  // past that point (no end, so it stays solid at the very bottom of the page).
  ScrollTrigger.create({
    trigger: '.content', start: 'top 72px',
    onEnter: () => header.classList.add('is-solid'),
    onLeaveBack: () => header.classList.remove('is-solid'),
  });
}

// ── Boot: preload frames, then reveal ────────────────────
const WARM_FRAMES = 40; // decoded before the page appears, so the first scroll is smooth

function preload(onProgress) {
  let loaded = 0;
  return Promise.all(
    Array.from({ length: FRAME_COUNT }, (_, i) => new Promise((res) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = img.onerror = () => { onProgress(++loaded / FRAME_COUNT); res(); };
      img.src = frameSrc(i);
      frames[i] = img;
    })),
  ).then(() => Promise.all(frames.slice(0, WARM_FRAMES).map((img) => img.decode().catch(() => {}))));
}

// Decode the remaining frames one at a time in idle moments, ahead of the
// scroll, instead of on first draw (which stutters on phones).
function decodeRest(i = WARM_FRAMES) {
  if (i >= FRAME_COUNT) return;
  const next = () => frames[i].decode().catch(() => {}).then(() => decodeRest(i + 1));
  'requestIdleCallback' in window ? requestIdleCallback(next) : setTimeout(next, 16);
}

const bar = document.getElementById('loaderBar');
lenis?.stop();
scrollTo(0, 0);

preload((p) => { bar.style.width = `${p * 100}%`; }).then(() => {
  // Start at the top. Lenis keeps its own target, so reset it too, or it
  // smooth-scrolls back to wherever the page was before the reload.
  scrollTo(0, 0);
  lenis?.start();
  lenis?.scrollTo(0, { immediate: true, force: true });
  resize();
  addEventListener('resize', resize);
  const tl = buildTimeline();
  wireAutoplay(tl);
  wireHeader();
  decodeRest();

  document.getElementById('loader').classList.add('is-done');
  gsap.from('.stage__canvas', { autoAlpha: 0, scale: 1.04, duration: 1.4, ease: 'power3.out' });
  gsap.from('#heroTitle', { autoAlpha: 0, y: 40, duration: 1.2, ease: 'power3.out', delay: 0.15 });
  gsap.from('.header, [data-scene="1"] .scene__foot, .order-fab, .autoplay', { autoAlpha: 0, duration: 1, delay: 0.5 });
});
