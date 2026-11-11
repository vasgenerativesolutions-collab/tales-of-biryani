import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import './reveal.js';

gsap.registerPlugin(ScrollTrigger);

const FRAME_COUNT = 190;
const FRAME_END = 0.78; // timeline point where the camera reaches the close-up
const frameSrc = (i) => `/frames/f_${String(i).padStart(3, '0')}.webp`;

const canvas = document.getElementById('bowl');
const ctx = canvas.getContext('2d');
const frames = [];
const state = { frame: 0 };
let drawn = -1;

// ── Smooth scroll ────────────────────────────────────────
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lenis = reduceMotion ? null : new Lenis({ duration: 1.2, smoothWheel: true });
if (lenis) {
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

// ── Canvas ───────────────────────────────────────────────
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  drawn = -1;
  draw();
}

function draw() {
  const i = Math.round(state.frame);
  const img = frames[i];
  if (i === drawn || !img?.complete) return;
  drawn = i;

  const cw = canvas.width, ch = canvas.height;
  const portrait = ch > cw;
  // Desktop: frame fills ~74% of the height. Phone: pot + lid fit the width.
  const scale = portrait ? (cw * 1.5) / img.width : (ch * 0.74) / img.height;
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
  tl.to('.stage__canvas', { scale: 0.72, duration: 0.08, transformOrigin: '50% 53%' }, 0.76);
  reveal(4, 0.8, null);
  // Floating Order now gives way to scene 4's own buttons.
  tl.to('.order-fab', { autoAlpha: 0, y: 20, duration: 0.04 }, 0.77);

  return tl;
}

// ── Home: solid header once the content scrolls under it ──
function wireHeader() {
  const header = document.querySelector('.header');
  ScrollTrigger.create({
    trigger: '.content', start: 'top 72px', end: 'max',
    onToggle: (self) => header.classList.toggle('is-solid', self.isActive),
  });
}

// ── Boot: preload frames, then reveal ────────────────────
function preload(onProgress) {
  let loaded = 0;
  return Promise.all(
    Array.from({ length: FRAME_COUNT }, (_, i) => new Promise((res) => {
      const img = new Image();
      img.onload = img.onerror = () => { onProgress(++loaded / FRAME_COUNT); res(); };
      img.src = frameSrc(i);
      frames[i] = img;
    })),
  );
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
  buildTimeline();
  wireHeader();

  document.getElementById('loader').classList.add('is-done');
  gsap.from('.stage__canvas', { autoAlpha: 0, scale: 1.04, duration: 1.4, ease: 'power3.out' });
  gsap.from('#heroTitle', { autoAlpha: 0, y: 40, duration: 1.2, ease: 'power3.out', delay: 0.15 });
  gsap.from('.header, [data-scene="1"] .scene__foot, .order-fab', { autoAlpha: 0, duration: 1, delay: 0.5 });
});
