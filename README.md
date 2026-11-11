# Tales of Biryani

Single-page, scroll-driven website for a dum biryani kitchen.

## Run

```sh
cd website
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in website/dist
```

## Structure

- `website/` — Vite + GSAP ScrollTrigger + Lenis. Scroll story in `src/main.js`, styles in `src/style.css`.
- `website/public/frames/` — 190 transparent bowl frames, scrubbed by scroll.
- `scripts/build_web_frames.py` — rebuilds those frames from the pot video
  (`ffmpeg -i pot.mp4 frames/p_%03d.png`, then `python scripts/build_web_frames.py frames`).
- `supabase/` — database schema and Razorpay edge functions (not wired to the site yet).
