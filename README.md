# Truck Weather Router

A React + Django app that helps a truck driver pick the safest route for a trip. It gets three
route options, checks the forecast at every checkpoint for the time the truck will actually be
there, scores each stretch against the wind / rain / snow rules (including the load rules), and
recommends a route.

- **Live app:** https://truck-weather-router-eight.vercel.app
- **Walkthrough video:** https://www.loom.com/share/7ed43efc61ab4f5b9fc7b1f0cc08622a

## What it does

1. You enter origin, destination, departure time, load weight and how often to sample the weather
   (every 10, 25 or 50 miles).
2. The backend asks Valhalla for truck routes and keeps three that are really different roads.
3. Each route is walked from start to finish. Every N miles there is a checkpoint with an ETA
   taken from the routing engine's own timing, not from an average speed.
4. One batched Open-Meteo request returns the hourly forecast for all checkpoints. Each checkpoint
   uses the forecast hour closest to its ETA.
5. Each checkpoint is classified Low / Moderate / High / Severe / No Travel, and the route that
   ranks best is recommended, with a one-line reason.
6. The map shows all routes, the checkpoints coloured by risk, and a weather heatmap of the
   corridor that you can scrub or play through the next 48 hours.

The map opens on a globe and flies down to a tilted 3D view of the trip. In 3D each checkpoint
on the selected route is a column whose height is its risk level, so a bad stretch stands out as
a skyline; the 2D button switches back to a flat map.

## Risk rules

Implemented in [`backend/planner/services/risk.py`](backend/planner/services/risk.py) and covered
by [`test_risk.py`](backend/planner/tests/test_risk.py).

| Condition    | Low   | Moderate  | High      | Severe    | No Travel |
| ------------ | ----- | --------- | --------- | --------- | --------- |
| Wind (mph)   | <25   | 25–34     | 35–44     | 45–54     | ≥55       |
| Rain (in/hr) | <0.10 | 0.10–0.25 | 0.25–0.50 | 0.50–1.00 | >1.00     |
| Snow (in/hr) | <0.5  | 0.5–1.0   | 1.0–2.0   | 2.0–3.0   | >3.0      |

Load rules: ≥55 mph is No Travel for any load, 45–54 mph with more than 30,000 lb is No Travel,
35–44 mph with more than 40,000 lb is Severe.

A checkpoint's level is the worst of its wind, rain and snow levels.

## Recommendation

Each checkpoint stands for the road halfway back to the previous checkpoint and halfway on to the
next, so every mile of the route belongs to exactly one checkpoint. That gives miles per risk
level. Routes are then sorted by:

1. fewest Severe miles
2. fewest High miles
3. lowest average risk (distance-weighted, Low = 0 … No Travel = 4)
4. shortest travel time

See [`recommend.py`](backend/planner/services/recommend.py).

## Decisions and assumptions

Things the brief left open, and what I went with:

- **No Travel miles are compared before Severe miles.** The ranking list starts at Severe, but a
  stretch you should not drive at all has to count as worse.
- **Boundary values go to the higher band.** The table's bands share their edges (0.25 in/hr is
  in both Moderate and High), so 0.25 is High. The top band is the exception because the table
  says "greater than": exactly 1.00 in/hr of rain is Severe.
- **Wind means sustained wind speed** at 10 m. Gusts are shown in the checkpoint popup but are
  not used for the level.
- **Miles are rounded to whole miles and average risk to two decimals before comparing**, so a
  route does not lose to one that is an hour slower over a third of a mile.
- **Third route.** Valhalla often returns only one or two alternates. When it does, the backend
  generates more candidates (detours through points either side of the direct line, and routes
  with different highway / toll preferences) and keeps the fastest ones that overlap the existing
  routes by less than 80% and are not more than 1.6× slower. If there still aren't three, the app
  shows what exists and says so.
- **Truck profile.** Routing uses Valhalla's truck costing with a gross weight of load + 32,000 lb
  (empty tractor and trailer), capped at 80,000 lb.
- **Heatmap window** is the next 48 hours from now, not from departure, since that is what a
  forecast slider normally means. The Risk layer applies the same load rules as the checkpoints.
- **ETAs are driving time only.** Fuel stops and hours-of-service breaks are not modelled.
- Times are shown in the browser's timezone.

## Architecture

```
backend/                Django + DRF, no database
  planner/services/
    routing.py          Valhalla client, alternative routes, ETA along the line
    weather.py          Open-Meteo client (batched, cached)
    risk.py             thresholds and load rules
    recommend.py        miles per level, ranking, explanation
    planner.py          ties the above together for /api/plan/
    heatmap.py          forecast grid around the routes for /api/heatmap/
    geocoding.py        Photon place search
frontend/               React + TypeScript + Vite, MapLibre GL
  src/components/       form, route cards, checkpoint table, map, heatmap controls
  src/lib/heatField.ts  draws the forecast grid to a canvas
```

API:

| Endpoint             | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `GET /api/geocode/`  | place suggestions for `?q=`                                |
| `POST /api/plan/`    | routes, checkpoints, summaries and the recommendation      |
| `POST /api/heatmap/` | 49 hourly frames of wind / rain / snow / risk on a grid    |

The routes come back first; the heatmap is a second request so the map is usable sooner.

### Performance notes

- Route geometry is simplified on the server (Valhalla sends about 50 points per mile) before it
  goes to the browser.
- Checkpoints from all three routes are fetched in one weather call, and points within ~3 miles
  of each other share a lookup.
- The heatmap grid is sized to the trip (0.1° cells for a short hop, coarser for long hauls) so
  it stays under ~220 cells. All 48 hours arrive in one response, so moving the slider never hits
  the network.
- The grid is drawn to a small canvas that MapLibre stretches over the corridor as a raster
  layer. Each frame is interpolated between grid cells and between hours, which is what makes
  playback smooth.
- Route and forecast responses are cached in memory for 10–15 minutes (per instance, so on
  serverless hosting the cache only helps while a function stays warm).

## Third-party services

All free and keyless, so there is nothing to configure:

- [Valhalla](https://github.com/valhalla/valhalla) (public FOSSGIS server) for truck routing
- [Open-Meteo](https://open-meteo.com/) for hourly forecasts
- [Photon](https://photon.komoot.io/) for place search
- [OpenFreeMap](https://openfreemap.org/) for the basemap

Limits that come with that: the public Valhalla server caps trips at about 930 miles
straight-line, forecasts only go 16 days out (the form allows 13), and Open-Meteo's free tier is
rate limited. Each service URL can be overridden with an environment variable (see
`backend/config/settings.py`) to point at a self-hosted or paid instance.

## Running locally

Needs Python 3.11+ and Node 20+.

```bash
# API on http://127.0.0.1:8000
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py runserver

# UI on http://localhost:5173 (proxies /api to the Django server)
cd frontend
npm install
npm run dev
```

If port 8000 is taken, run Django on another port and put `API_PROXY=http://127.0.0.1:<port>` in
`frontend/.env.local`.

Tests:

```bash
cd backend
python manage.py test
```

## Deployment

The hosted version runs on Vercel. `vercel.json` builds the React bundle and serves it as static
files, and `api/index.py` exposes the Django app as one serverless function that handles
everything under `/api/`. No environment variables are required.

It also runs as a single long-lived service: `build.sh` installs the API and builds the bundle,
and Django serves the bundle with WhiteNoise next to the API. Start it with
`cd backend && gunicorn config.wsgi --workers 1 --threads 8`, set `DJANGO_DEBUG=0` and a
`DJANGO_SECRET_KEY`, and add the hostname to `DJANGO_ALLOWED_HOSTS`.

## What I'd do next

- Hours-of-service breaks and fuel stops in the ETA.
- "Leave later" suggestions when every route is Severe or worse.
- Use gusts for high-profile trailers, and ice / visibility as extra conditions.
- A self-hosted Valhalla to remove the trip length cap.
