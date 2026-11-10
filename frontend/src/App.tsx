import { useCallback, useRef, useState } from 'react'

import HeatControls from './components/HeatControls'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import { fetchHeatmap, planTrip } from './lib/api'
import { HeatField } from './lib/heatField'
import type { Checkpoint, HeatLayer, TripPlan, TripRequest } from './lib/types'

export default function App() {
  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState<Checkpoint | null>(null)
  const [trip, setTrip] = useState<TripRequest | null>(null)
  const [tilted, setTilted] = useState(true)

  const [heat, setHeat] = useState<HeatField | null>(null)
  const [heatStatus, setHeatStatus] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [heatLayer, setHeatLayer] = useState<HeatLayer>('risk')
  const [heatVisible, setHeatVisible] = useState(true)
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)

  const pending = useRef<AbortController | null>(null)

  const submit = useCallback(async (trip: TripRequest) => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller

    setLoading(true)
    setError(null)
    let result: TripPlan
    try {
      result = await planTrip(trip, controller.signal)
    } catch (err) {
      if (controller.signal.aborted) return
      setError((err as Error).message)
      setLoading(false)
      return
    }

    setPlan(result)
    setTrip(trip)
    setSelectedId(result.recommended_route_id)
    setFocus(null)
    setLoading(false)

    // Routes are on screen now; the forecast grid follows when it is ready.
    setHeat(null)
    setPlaying(false)
    setHour(0)
    setHeatStatus('loading')
    try {
      const grid = await fetchHeatmap(result.routes, trip.load_lbs, controller.signal)
      setHeat(new HeatField(grid))
      setHeatStatus('idle')
    } catch {
      if (!controller.signal.aborted) setHeatStatus('failed')
    }
  }, [])

  return (
    <div className="app">
      <Sidebar
        plan={plan}
        trip={trip}
        selectedId={selectedId}
        loading={loading}
        error={error}
        onSubmit={submit}
        onSelect={setSelectedId}
        onHoverCheckpoint={setFocus}
      />

      <main className="map-area">
        <MapView
          plan={plan}
          selectedId={selectedId}
          onSelect={setSelectedId}
          heat={heat}
          heatLayer={heatLayer}
          heatVisible={heatVisible}
          hour={hour}
          focus={focus}
          tilted={tilted}
        />

        {plan && (
          <button
            type="button"
            className="view-toggle"
            aria-pressed={tilted}
            title={tilted ? 'Switch to a flat map' : 'Switch to the 3D view'}
            onClick={() => setTilted((t) => !t)}
          >
            {tilted ? '2D' : '3D'}
          </button>
        )}

        {loading && (
          <div className="map-status">
            <span className="spinner" aria-hidden="true" />
            Finding routes and checking the weather…
          </div>
        )}

        {heat && (
          <HeatControls
            hours={heat.hours}
            hour={hour}
            onHourChange={setHour}
            layer={heatLayer}
            onLayerChange={setHeatLayer}
            visible={heatVisible}
            onVisibleChange={setHeatVisible}
            playing={playing}
            onPlayingChange={setPlaying}
          />
        )}
        {!heat && heatStatus !== 'idle' && (
          <div className="heat-controls note">
            {heatStatus === 'loading'
              ? 'Loading the 48-hour forecast for this corridor…'
              : 'The forecast heatmap could not be loaded. Routes and checkpoints are still accurate.'}
          </div>
        )}
      </main>
    </div>
  )
}
