import { useState } from 'react'

import { toLocalInputValue } from '../lib/format'
import type { Place, TripRequest } from '../lib/types'
import PlaceInput from './PlaceInput'

const INTERVALS = [10, 25, 50]
const MAX_LOAD = 80000

const SAMPLE_TRIPS: { name: string; origin: Place; destination: Place }[] = [
  {
    name: 'Chicago → Denver',
    origin: { label: 'Chicago, Illinois, United States', lat: 41.8756, lon: -87.6244 },
    destination: { label: 'Denver, Colorado, United States', lat: 39.7392, lon: -104.9849 },
  },
  {
    name: 'Dallas → Houston',
    origin: { label: 'Dallas, Texas, United States', lat: 32.7763, lon: -96.7969 },
    destination: { label: 'Houston, Texas, United States', lat: 29.7589, lon: -95.3677 },
  },
  {
    name: 'Seattle → Boise',
    origin: { label: 'Seattle, Washington, United States', lat: 47.6038, lon: -122.3301 },
    destination: { label: 'Boise, Idaho, United States', lat: 43.6166, lon: -116.2009 },
  },
]

function defaultDeparture() {
  // next full hour
  const date = new Date()
  date.setHours(date.getHours() + 1, 0, 0, 0)
  return toLocalInputValue(date)
}

function loadHint(load: number) {
  if (load > 40000) return 'Over 40,000 lb: wind of 35+ mph is Severe, 45+ mph is No Travel.'
  if (load > 30000) return 'Over 30,000 lb: wind of 45+ mph is No Travel.'
  return 'Wind of 55+ mph is No Travel for any load.'
}

interface Props {
  loading: boolean
  onSubmit: (trip: TripRequest) => void
}

export default function TripForm({ loading, onSubmit }: Props) {
  const [origin, setOrigin] = useState<Place | null>(null)
  const [destination, setDestination] = useState<Place | null>(null)
  const [departure, setDeparture] = useState(defaultDeparture)
  const [load, setLoad] = useState('35000')
  const [interval, setIntervalMiles] = useState(25)
  const [error, setError] = useState<string | null>(null)

  const loadLbs = Number(load)

  const swap = () => {
    setOrigin(destination)
    setDestination(origin)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!origin || !destination) {
      setError('Pick an origin and a destination from the suggestions.')
      return
    }
    const when = new Date(departure)
    if (Number.isNaN(when.getTime())) {
      setError('Enter a departure date and time.')
      return
    }
    if (load === '' || !Number.isFinite(loadLbs) || loadLbs < 0 || loadLbs > MAX_LOAD) {
      setError(`Load weight must be between 0 and ${MAX_LOAD.toLocaleString()} lb.`)
      return
    }
    setError(null)
    onSubmit({
      origin,
      destination,
      departure: when.toISOString(),
      load_lbs: Math.round(loadLbs),
      interval_miles: interval,
    })
  }

  return (
    <form className="trip-form" onSubmit={submit} noValidate>
      <div className="places">
        <PlaceInput label="From" placeholder="Origin city or address" value={origin} onChange={setOrigin} />
        <button
          type="button"
          className="swap"
          onClick={swap}
          disabled={!origin && !destination}
          aria-label="Swap origin and destination"
          title="Swap origin and destination"
        >
          ⇅
        </button>
        <PlaceInput
          label="To"
          placeholder="Destination city or address"
          value={destination}
          onChange={setDestination}
        />
      </div>

      <div className="samples">
        <span>Try</span>
        {SAMPLE_TRIPS.map((trip) => (
          <button
            key={trip.name}
            type="button"
            onClick={() => {
              setOrigin(trip.origin)
              setDestination(trip.destination)
            }}
          >
            {trip.name}
          </button>
        ))}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="departure">Departure</label>
          <input
            id="departure"
            type="datetime-local"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
          />
        </div>
        <div className="field load">
          <label htmlFor="load">Load weight</label>
          <div className="with-unit">
            <input
              id="load"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_LOAD}
              step={500}
              value={load}
              onChange={(e) => setLoad(e.target.value)}
            />
            <span>lb</span>
          </div>
        </div>
      </div>
      <p className="hint">{loadHint(loadLbs)}</p>

      <div className="field">
        <label>Check weather every</label>
        <div className="segmented">
          {INTERVALS.map((miles) => (
            <button
              key={miles}
              type="button"
              className={miles === interval ? 'on' : ''}
              aria-pressed={miles === interval}
              onClick={() => setIntervalMiles(miles)}
            >
              {miles} mi
            </button>
          ))}
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <button className="cta" type="submit" disabled={loading}>
        {loading ? (
          <>
            <span className="spinner" aria-hidden="true" />
            Checking the road ahead…
          </>
        ) : (
          <>
            Find the safest route
            <span className="arrow" aria-hidden="true">
              →
            </span>
          </>
        )}
      </button>
    </form>
  )
}
