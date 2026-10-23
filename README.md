# Ad Wars

Fly a spaceship through a 3D solar system lined with animated, clickable billboards, each one an ad slot you can sell.

- **The universe:** a shader-animated Sun, eight planets plus the Moon, Saturn's and Uranus's rings, an asteroid belt, stars and nebulae. Everything is procedural, so there are no image assets to host.
- **Flight:** six degrees of freedom. Mouse to steer, `WASD` to thrust, `Shift` to boost, `Q`/`E` to roll, `0–8` to warp to a planet, `Tab` to warp to the next ad. On phones, use the left thumb to fly and the right thumb to steer.
- **Billboards:** animated screens framed by chasing marquee lights. They orbit their planet and turn to face the viewer. Clicking one opens the advertiser's site. An unsold slot shows an animated "YOUR AD HERE" card, and clicking it opens the rate card for that slot.
- **Rate card** (`/advertise.html`): every slot with a live preview, tier, price and status, plus a pre-filled enquiry email.
- **Measurement:** impressions, view time and clicks per slot. These are the numbers you quote to advertisers.

## Run it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in dist/
npm run preview   # serve the built site
```

`dist/` is a plain static site. Deploy it to Netlify, Vercel, Cloudflare Pages or GitHub Pages. For GitHub Pages under a sub-path, set `base` in `vite.config.ts`.

## Selling a slot

All inventory lives in [`public/ads.json`](public/ads.json). Edit it and redeploy; no code changes are needed.

```jsonc
{
  "siteName": "Ad Wars",
  "contactEmail": "advertise@example.com",   // used on the boards and the rate card
  "currency": "GBP",
  "analyticsEndpoint": null,                   // see "Measurement" below
  "slots": [
    {
      "id": "EARTH-01",
      "name": "Earth Orbit Prime",
      "tier": "premium",                       // standard | premium | landmark (sets the frame colour)
      "pricePerMonth": 2000,
      "anchor": "earth",                       // sun, mercury, venus, earth, moon, mars, jupiter, saturn, uranus, neptune, or "space"
      "orbitRadius": 26,                       // distance from the anchor
      "orbitSpeed": 0.05,                      // radians per second around the anchor
      "phase": 0,                              // starting angle in degrees
      "height": 6,                             // above/below the orbital plane
      "width": 26,                             // billboard width; the screen is 16:9
      "booking": null                          // null = available
    }
  ]
}
```

Use `"anchor": "space"` with `"position": [x, y, z]` to place a fixed billboard, like the giant `ZENITH` board above the Sun.

To sell a slot, fill in `booking`:

```jsonc
"booking": {
  "advertiser": "Nebula Cola",
  "url": "https://nebulacola.example",
  "start": "2026-11-01",        // optional; outside start–end the slot shows as available
  "end": "2026-11-30",
  "creative": { ... }
}
```

### Creative types

| Type | Use it for | Example |
| --- | --- | --- |
| `animated` | The advertiser sends text and brand colours, and the site animates it. Templates are `neon` (synthwave grid and flicker), `marquee` (scrolling ticker) and `pulse` (beating logo and rings). | `{ "type": "animated", "template": "neon", "headline": "NEBULA COLA", "tagline": "Now with 40% more stardust", "cta": "Taste the cosmos", "colors": ["#12001f", "#ffffff", "#ff3df2"] }` |
| `video` | Full custom animation. Use MP4 or WebM, 16:9, muted and looping. | `{ "type": "video", "src": "/creatives/acme.mp4" }` |
| `image` | A static artwork with screen effects added on top. Use PNG or JPG, 16:9. | `{ "type": "image", "src": "/creatives/acme.png" }` |

Put uploaded creatives in `public/creatives/`. Files hosted on other domains must send CORS headers. Animated GIFs only show their first frame, so convert them to MP4.

The bookings in the shipped `ads.json` (Nebula Cola, Orbit Coffee and others) are fictional demo brands linking to `example.com`. Replace them, and set `contactEmail` to your real address, before you launch.

## Measurement

The site counts an **impression** when a board is at least 48px tall on screen, not hidden behind a planet, and stays in view for at least 1 second. The same visitor seeing the board again after looking away for 5 seconds counts as a new impression. **View seconds** and **clicks** are also tracked per slot.

- In the browser console, `adStats` shows the current session's totals.
- If you set `analyticsEndpoint`, batches are sent there with `navigator.sendBeacon` every 15 seconds, on every click, and when the tab is hidden:

```json
{
  "session": "6f0c…",
  "events": [
    { "type": "impression", "slotId": "EARTH-01", "advertiser": "Nebula Cola", "at": "2026-10-23T15:00:00.000Z" },
    { "type": "view", "slotId": "EARTH-01", "advertiser": "Nebula Cola", "seconds": 4.2, "at": "…" },
    { "type": "click", "slotId": "EARTH-01", "advertiser": "Nebula Cola", "at": "…" }
  ]
}
```

Any endpoint that accepts a JSON POST works: a serverless function writing to a database, or a webhook into your analytics tool.

## Code map

| File | What it does |
| --- | --- |
| `src/main.ts` | Renderer, bloom, game loop, HUD, warps, click handling |
| `src/solarSystem.ts` | Sun shader, planets, rings, belt, starfield and nebulae |
| `src/textures.ts` | Procedural planet, cloud, ring and nebula textures |
| `src/flight.ts` | Spaceship controls (mouse, keyboard, touch), warps, collisions |
| `src/billboards.ts` | Billboard meshes, chase-light frame shader, facing, impression tracking, picking |
| `src/creatives.ts` | Canvas painters for the animated templates, image/video and "available" cards |
| `src/ads.ts` | `ads.json` types and helpers |
| `src/analytics.ts` | Impression, view and click counting and beaconing |
| `src/advertise.ts` | The rate card page |

## Ideas for next steps

- Self-serve booking: Stripe Checkout per slot, with a small backend that writes the booking.
- An advertiser dashboard reading the analytics endpoint's data.
- Rotating several advertisers through one slot, priced by share of voice.
- Sound, a cockpit overlay, and more destinations such as wormholes or a distant galaxy as premium zones.
