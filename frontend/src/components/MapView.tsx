import { useEffect, useRef, useState } from 'react'
import maplibregl, { type CanvasSource, type GeoJSONSource, type Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import { formatDayTime } from '../lib/format'
import type { HeatField } from '../lib/heatField'
import { LEVELS, UNKNOWN_COLOR, levelColor, levelLabel } from '../lib/risk'
import type { Checkpoint, HeatLayer, RouteOption, TripPlan } from '../lib/types'

const BASEMAP = 'https://tiles.openfreemap.org/styles/fiord'
const GLOBE_VIEW = { center: [-98, 34] as [number, number], zoom: 1.7 }
const TILT = 52
const SPIN_DEG_PER_SEC = 2.5
const MOBILE_WIDTH = 860

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

// match expression: checkpoint level -> colour
const LEVEL_COLOR_EXPR = [
  'match',
  ['get', 'level'],
  ...LEVELS.flatMap((l) => [l.id, l.color]),
  UNKNOWN_COLOR,
] as unknown as maplibregl.ExpressionSpecification

// Pillar height per risk level, as a share of the route length, so the
// skyline reads the same on a 200 mile trip and a 1,000 mile one.
const PILLAR_HEIGHT: Record<string, number> = {
  low: 0.006,
  moderate: 0.02,
  high: 0.035,
  severe: 0.05,
  no_travel: 0.065,
  unknown: 0.004,
}
const METERS_PER_MILE = 1609.34

interface Props {
  plan: TripPlan | null
  selectedId: string | null
  onSelect: (routeId: string) => void
  heat: HeatField | null
  heatLayer: HeatLayer
  heatVisible: boolean
  hour: number
  focus: Checkpoint | null
  tilted: boolean
}

export default function MapView(props: Props) {
  const { plan, selectedId, onSelect, heat, heatLayer, heatVisible, hour, focus, tilted } = props

  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markers = useRef<maplibregl.Marker[]>([])
  const popup = useRef<maplibregl.Popup | null>(null)
  const spinning = useRef(false)
  const [ready, setReady] = useState(false)

  // Map event handlers are bound once, so they read the latest props from here.
  const latest = useRef({ plan, selectedId, onSelect, tilted })
  latest.current = { plan, selectedId, onSelect, tilted }

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: BASEMAP,
      ...GLOBE_VIEW,
      maxPitch: 70,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.setPadding(panelPadding())
    map.on('resize', () => map.setPadding(panelPadding()))
    mapRef.current = map

    const openPopup = (e: maplibregl.MapLayerMouseEvent) => {
      const props = e.features?.[0]?.properties
      const route = latest.current.plan?.routes.find((r) => r.id === props?.routeId)
      const checkpoint = route?.checkpoints[props?.index]
      if (!route || !checkpoint) return
      popup.current?.remove()
      popup.current = new maplibregl.Popup({ offset: 12, maxWidth: '260px' })
        .setLngLat([checkpoint.lon, checkpoint.lat])
        .setDOMContent(checkpointPopup(route, checkpoint))
        .addTo(map)
    }

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' })
      map.setSky({
        'sky-color': '#0a1020',
        'horizon-color': '#1a2c55',
        'fog-color': '#0a1020',
        'sky-horizon-blend': 0.7,
        'horizon-fog-blend': 0.8,
        'fog-ground-blend': 0.5,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.8, 7, 0],
      })
    })

    map.on('load', () => {
      addLayers(map)

      map.on('click', 'routes-hit', (e) => {
        // a click on a checkpoint opens its popup instead
        const onCheckpoint = map.queryRenderedFeatures(e.point, { layers: ['checkpoints', 'pillars'] })
        if (onCheckpoint.length) return
        // where routes overlap, prefer switching to the one not already selected
        const ids = (e.features ?? []).map((f) => f.properties.id as string)
        const id = ids.find((x) => x !== latest.current.selectedId) ?? ids[0]
        if (id) latest.current.onSelect(id)
      })
      map.on('click', 'checkpoints', openPopup)
      map.on('click', 'pillars', openPopup)

      for (const layer of ['routes-hit', 'checkpoints', 'pillars']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
      }
      setReady(true)

      // Start turning once the first tiles are drawn, otherwise the globe
      // spins as a blank ball while they load.
      if (spinning.current) {
        previous = performance.now()
        frame = requestAnimationFrame(spin)
      }
    })

    // Slowly turn the globe until the user touches it or plans a trip.
    let frame = 0
    let previous = 0
    spinning.current = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const spin = (now: number) => {
      if (!spinning.current) return
      // cap the step so a background tab doesn't jump when it comes back
      const seconds = Math.min((now - previous) / 1000, 0.1)
      previous = now
      const center = map.getCenter()
      center.lng += seconds * SPIN_DEG_PER_SEC
      map.jumpTo({ center })
      frame = requestAnimationFrame(spin)
    }
    const stopSpin = () => (spinning.current = false)
    for (const event of ['mousedown', 'touchstart', 'wheel'] as const) {
      map.on(event, stopSpin)
    }

    return () => {
      cancelAnimationFrame(frame)
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // The map, once its sources and layers are in place.
  const liveMap = () => {
    const map = mapRef.current
    return ready && map?.getSource('routes') ? map : null
  }

  // New plan: draw every route and fly down to it.
  useEffect(() => {
    const map = liveMap()
    if (!map) return

    popup.current?.remove()
    markers.current.forEach((m) => m.remove())
    markers.current = []

    const routes = plan?.routes ?? []
    source(map, 'routes').setData({
      type: 'FeatureCollection',
      features: routes.map((route) => ({
        type: 'Feature',
        properties: { id: route.id },
        geometry: { type: 'LineString', coordinates: route.geometry },
      })),
    })
    if (!routes.length) return

    const first = routes[0].geometry
    markers.current = [
      endpointMarker('A', first[0]).addTo(map),
      endpointMarker('B', first[first.length - 1]).addTo(map),
    ]

    spinning.current = false
    const bounds = new maplibregl.LngLatBounds()
    routes.forEach((route) => route.geometry.forEach((point) => bounds.extend(point)))
    const mobile = window.innerWidth <= MOBILE_WIDTH
    map.fitBounds(bounds, {
      padding: mobile ? 30 : { top: 70, bottom: 170, left: 50, right: 70 },
      pitch: latest.current.tilted ? TILT : 0,
      bearing: 0,
      duration: 2600,
    })
  }, [plan, ready])

  // Selection: the chosen route is drawn on top of the others, coloured by
  // risk, with a pillar at each checkpoint.
  useEffect(() => {
    const map = liveMap()
    if (!map) return

    const routes = plan?.routes ?? []
    const selected = routes.find((r) => r.id === selectedId)

    source(map, 'selected').setData(
      selected
        ? {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: selected.geometry },
          }
        : EMPTY,
    )
    if (selected) {
      map.setPaintProperty('selected-line', 'line-gradient', riskGradient(selected))
    }
    source(map, 'pillars').setData(selected && plan ? pillars(selected, plan.interval_miles) : EMPTY)

    source(map, 'checkpoints').setData({
      type: 'FeatureCollection',
      features: routes.flatMap((route) =>
        route.checkpoints.map((cp) => ({
          type: 'Feature' as const,
          properties: {
            routeId: route.id,
            index: cp.index,
            level: cp.risk?.level ?? 'unknown',
            selected: route.id === selectedId,
          },
          geometry: { type: 'Point' as const, coordinates: [cp.lon, cp.lat] },
        })),
      ),
    })
  }, [plan, selectedId, ready])

  // 3D / flat toggle.
  useEffect(() => {
    const map = liveMap()
    if (!map) return
    map.setLayoutProperty('pillars', 'visibility', tilted ? 'visible' : 'none')
    // leave the camera alone while the intro globe is still showing
    if (latest.current.plan) {
      map.easeTo({ pitch: tilted ? TILT : 0, bearing: tilted ? map.getBearing() : 0, duration: 900 })
    }
  }, [tilted, ready])

  // A new forecast grid means a new canvas with different bounds.
  useEffect(() => {
    const map = liveMap()
    if (!map || !heat) return

    map.addSource('heat', {
      type: 'canvas',
      canvas: heat.canvas,
      coordinates: heat.corners,
      animate: false,
    })
    map.addLayer(
      {
        id: 'heat',
        type: 'raster',
        source: 'heat',
        paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
      },
      'routes-other-casing',
    )
    return () => {
      if (!mapRef.current) return
      map.removeLayer('heat')
      map.removeSource('heat')
    }
  }, [heat, ready])

  useEffect(() => {
    const map = liveMap()
    if (!map || !heat) return

    map.setLayoutProperty('heat', 'visibility', heatVisible ? 'visible' : 'none')
    if (!heatVisible) return

    heat.draw(heatLayer, hour)
    // A paused canvas source only re-reads the canvas when it is paused
    // again, so toggle it to push the new frame to the GPU.
    const src = map.getSource('heat') as CanvasSource
    src.play()
    src.pause()
    map.triggerRepaint()
  }, [heat, heatLayer, heatVisible, hour, ready])

  // Checkpoint hovered in the sidebar.
  useEffect(() => {
    const map = liveMap()
    if (!map) return
    source(map, 'focus').setData(
      focus
        ? {
            type: 'Feature',
            properties: { level: focus.risk?.level ?? 'unknown' },
            geometry: { type: 'Point', coordinates: [focus.lon, focus.lat] },
          }
        : EMPTY,
    )
  }, [focus, ready])

  return <div ref={container} className="map" />
}

// Keep the map's focal point clear of the floating panel on desktop.
function panelPadding() {
  const mobile = window.innerWidth <= MOBILE_WIDTH
  return { top: 0, bottom: 0, right: 0, left: mobile ? 0 : 440 }
}

function source(map: MlMap, id: string) {
  return map.getSource(id) as GeoJSONSource
}

function addLayers(map: MlMap) {
  map.addSource('routes', { type: 'geojson', data: EMPTY })
  map.addSource('selected', { type: 'geojson', data: EMPTY, lineMetrics: true })
  map.addSource('checkpoints', { type: 'geojson', data: EMPTY })
  map.addSource('pillars', { type: 'geojson', data: EMPTY })
  map.addSource('focus', { type: 'geojson', data: EMPTY })

  const round = { 'line-cap': 'round', 'line-join': 'round' } as const

  map.addLayer({
    id: 'routes-other-casing',
    type: 'line',
    source: 'routes',
    layout: round,
    paint: { 'line-color': '#070b16', 'line-width': 7, 'line-opacity': 0.8 },
  })
  map.addLayer({
    id: 'routes-other',
    type: 'line',
    source: 'routes',
    layout: round,
    paint: { 'line-color': '#8493b3', 'line-width': 3.5 },
  })
  map.addLayer({
    id: 'selected-glow',
    type: 'line',
    source: 'selected',
    layout: round,
    paint: { 'line-color': '#5eead4', 'line-width': 18, 'line-blur': 14, 'line-opacity': 0.55 },
  })
  map.addLayer({
    id: 'selected-casing',
    type: 'line',
    source: 'selected',
    layout: round,
    paint: { 'line-color': '#f8fafc', 'line-width': 8.5 },
  })
  map.addLayer({
    id: 'selected-line',
    type: 'line',
    source: 'selected',
    layout: round,
    paint: {
      'line-width': 5.5,
      'line-gradient': ['step', ['line-progress'], LEVELS[0].color, 1, LEVELS[0].color],
    },
  })
  // wide invisible line so routes are easy to click
  map.addLayer({
    id: 'routes-hit',
    type: 'line',
    source: 'routes',
    paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0 },
  })
  map.addLayer({
    id: 'checkpoints',
    type: 'circle',
    source: 'checkpoints',
    layout: { 'circle-sort-key': ['case', ['get', 'selected'], 1, 0] },
    paint: {
      'circle-color': LEVEL_COLOR_EXPR,
      'circle-radius': ['case', ['get', 'selected'], 5.5, 3.5],
      'circle-stroke-color': '#f8fafc',
      'circle-stroke-width': ['case', ['get', 'selected'], 2, 1],
      'circle-opacity': ['case', ['get', 'selected'], 1, 0.8],
    },
  })
  map.addLayer({
    id: 'pillars',
    type: 'fill-extrusion',
    source: 'pillars',
    paint: {
      'fill-extrusion-color': LEVEL_COLOR_EXPR,
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-opacity': 0.85,
    },
  })
  map.addLayer({
    id: 'focus',
    type: 'circle',
    source: 'focus',
    paint: {
      'circle-color': LEVEL_COLOR_EXPR,
      'circle-radius': 11,
      'circle-stroke-color': '#f8fafc',
      'circle-stroke-width': 3,
    },
  })
}

// Colour the line by the risk of the checkpoint that covers each stretch.
function riskGradient(route: RouteOption) {
  const first = levelColor(route.checkpoints[0].risk?.level)
  const stops: (number | string)[] = []
  let lastStop = 0
  let lastColor = first
  for (const cp of route.checkpoints.slice(1)) {
    const color = levelColor(cp.risk?.level)
    const at = cp.from_mile / route.distance_miles
    // step stops have to be strictly increasing
    if (color !== lastColor && at > lastStop && at < 1) {
      stops.push(at, color)
      lastStop = at
      lastColor = color
    }
  }
  if (!stops.length) {
    // a step expression needs at least one stop
    return ['step', ['line-progress'], first, 1, first] as maplibregl.ExpressionSpecification
  }
  return ['step', ['line-progress'], first, ...stops] as maplibregl.ExpressionSpecification
}

// One hexagonal column per checkpoint; the worse the weather, the taller it is.
function pillars(route: RouteOption, intervalMiles: number): GeoJSON.FeatureCollection {
  const radiusMiles = Math.min(Math.max(route.distance_miles * 0.006, 0.6), intervalMiles * 0.3, 5)
  const routeMeters = route.distance_miles * METERS_PER_MILE

  return {
    type: 'FeatureCollection',
    features: route.checkpoints.map((cp) => {
      const level = cp.risk?.level ?? 'unknown'
      const dLat = radiusMiles / 69
      const dLon = dLat / Math.cos((cp.lat * Math.PI) / 180)
      const ring = []
      for (let i = 0; i <= 6; i++) {
        const angle = (i * Math.PI) / 3
        ring.push([cp.lon + dLon * Math.cos(angle), cp.lat + dLat * Math.sin(angle)])
      }
      return {
        type: 'Feature',
        properties: {
          routeId: route.id,
          index: cp.index,
          level,
          height: routeMeters * PILLAR_HEIGHT[level],
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      }
    }),
  }
}

function endpointMarker(letter: string, lngLat: [number, number]) {
  const el = document.createElement('div')
  el.className = 'endpoint-marker'
  el.textContent = letter
  return new maplibregl.Marker({ element: el }).setLngLat(lngLat)
}

function checkpointPopup(route: RouteOption, cp: Checkpoint) {
  const root = document.createElement('div')
  root.className = 'popup'

  const add = (className: string, text: string) => {
    const el = document.createElement('div')
    el.className = className
    el.textContent = text
    root.appendChild(el)
    return el
  }

  add('popup-title', `${route.name} · mile ${Math.round(cp.mile)}`)
  add('popup-eta', `ETA ${formatDayTime(cp.eta)}`)

  const badge = add('popup-level', levelLabel(cp.risk?.level))
  badge.style.background = levelColor(cp.risk?.level)

  if (cp.weather && cp.risk) {
    add('popup-reason', cp.risk.reason)
    const w = cp.weather
    const gust = w.gust_mph != null ? ` (gusts ${Math.round(w.gust_mph)})` : ''
    add('popup-row', `Wind ${Math.round(w.wind_mph)} mph${gust}`)
    add('popup-row', `Rain ${w.rain_in.toFixed(2)} in/hr`)
    add('popup-row', `Snow ${w.snow_in.toFixed(1)} in/hr`)
    if (w.temp_f != null) add('popup-row', `Temp ${Math.round(w.temp_f)}°F`)
  } else {
    add('popup-reason', 'No forecast for this time yet.')
  }
  return root
}
