import type { HeatGrid, Place, RouteOption, TripPlan, TripRequest } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new Error('Could not reach the server. Check your connection and try again.')
  }
  if (!res.ok) {
    throw new Error(await errorMessage(res))
  }
  return res.json()
}

// DRF errors come back as {detail: "..."} or {field: ["..."]}, sometimes nested.
function firstMessage(body: unknown): string | null {
  if (typeof body === 'string') return body
  if (Array.isArray(body)) {
    for (const item of body) {
      const msg = firstMessage(item)
      if (msg) return msg
    }
  } else if (body && typeof body === 'object') {
    for (const value of Object.values(body)) {
      const msg = firstMessage(value)
      if (msg) return msg
    }
  }
  return null
}

async function errorMessage(res: Response) {
  try {
    const msg = firstMessage(await res.json())
    if (msg) return msg
  } catch {
    // not JSON, fall through
  }
  return `Something went wrong (HTTP ${res.status}).`
}

function post<T>(path: string, body: unknown, signal?: AbortSignal) {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

export function searchPlaces(query: string, signal?: AbortSignal) {
  return request<Place[]>(`/geocode/?q=${encodeURIComponent(query)}`, { signal })
}

export function planTrip(trip: TripRequest, signal?: AbortSignal) {
  return post<TripPlan>(
    '/plan/',
    {
      origin: { lat: trip.origin.lat, lon: trip.origin.lon },
      destination: { lat: trip.destination.lat, lon: trip.destination.lon },
      departure: trip.departure,
      load_lbs: trip.load_lbs,
      interval_miles: trip.interval_miles,
    },
    signal,
  )
}

const MAX_PATH_POINTS = 300

export function fetchHeatmap(routes: RouteOption[], loadLbs: number, signal?: AbortSignal) {
  // The server only needs the rough shape of each route to build the corridor.
  const paths = routes.map((route) => {
    const stride = Math.ceil(route.geometry.length / MAX_PATH_POINTS)
    const path = route.geometry.filter((_, i) => i % stride === 0)
    path.push(route.geometry[route.geometry.length - 1])
    return path
  })
  return post<HeatGrid>('/heatmap/', { paths, load_lbs: loadLbs }, signal)
}
