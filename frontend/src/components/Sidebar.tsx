import { memo, useEffect, useState } from 'react'

import { formatDayTime, formatDuration, formatMiles } from '../lib/format'
import type { Checkpoint, TripPlan, TripRequest } from '../lib/types'
import CheckpointList from './CheckpointList'
import RouteCard from './RouteCard'
import TripForm from './TripForm'

interface Props {
  plan: TripPlan | null
  trip: TripRequest | null
  selectedId: string | null
  loading: boolean
  error: string | null
  onSubmit: (trip: TripRequest) => void
  onSelect: (routeId: string) => void
  onHoverCheckpoint: (checkpoint: Checkpoint | null) => void
}

const city = (label: string) => label.split(',')[0]

// Memoised because the heatmap animation re-renders App on every frame.
function Sidebar(props: Props) {
  const { plan, trip, selectedId, loading, error, onSubmit, onSelect, onHoverCheckpoint } = props

  // Once there are results the form folds into a one-line summary so the
  // routes get the space. It stays mounted, so "Edit" brings it back as it was.
  const [editing, setEditing] = useState(true)
  useEffect(() => {
    if (plan) setEditing(false)
  }, [plan])
  useEffect(() => {
    if (error) setEditing(true)
  }, [error])

  const selected = plan?.routes.find((r) => r.id === selectedId)
  const recommended = plan?.routes.find((r) => r.id === plan.recommended_route_id)
  const showForm = editing || !plan

  return (
    <aside className="panel">
      <header className="brand">
        <div className="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M2 7h11v8H2zM13 10h4.5L21 13v2h-8z" />
            <circle cx="6.5" cy="17" r="2" />
            <circle cx="17" cy="17" r="2" />
          </svg>
        </div>
        <div>
          <div className="brand-name">Truck Weather Router</div>
          <div className="brand-live">
            <i /> Live forecast
          </div>
        </div>
      </header>

      {!plan && (
        <div className="hero">
          <h1>
            Know the weather <span>before the wheels roll.</span>
          </h1>
          <p>
            Three truck routes, each checked against the forecast for the hour you will actually be
            on that stretch of road.
          </p>
        </div>
      )}

      {plan && trip && !showForm && (
        <button type="button" className="trip-summary" onClick={() => setEditing(true)}>
          <span className="trip-places">
            {city(trip.origin.label)} <em>→</em> {city(trip.destination.label)}
          </span>
          <span className="trip-meta">
            {formatDayTime(plan.departure)} · {plan.load_lbs.toLocaleString()} lb · every{' '}
            {plan.interval_miles} mi
          </span>
          <span className="trip-edit">Edit</span>
        </button>
      )}

      <div hidden={!showForm}>
        <TripForm loading={loading} onSubmit={onSubmit} />
        {error && <p className="form-error">{error}</p>}
      </div>

      {!plan && !loading && (
        <ul className="features">
          <li>
            <strong>3</strong> route options
          </li>
          <li>
            <strong>ETA</strong>-matched weather
          </li>
          <li>
            <strong>48 h</strong> heatmap
          </li>
        </ul>
      )}

      {!plan && loading && (
        <div className="skeletons" aria-label="Loading routes">
          <div className="skeleton tall" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}

      {plan && recommended && (
        <section className={`results${loading ? ' stale' : ''}`}>
          <div className="recommendation">
            <div className="eyebrow">Recommended</div>
            <div className="recommendation-title">Take {recommended.name}</div>
            <p>{plan.reason}</p>
            <div className="tiles">
              <div>
                <strong>{formatDuration(recommended.duration_s)}</strong>
                <span>drive time</span>
              </div>
              <div>
                <strong>{formatMiles(recommended.distance_miles)}</strong>
                <span>distance</span>
              </div>
              <div>
                <strong>{formatDayTime(recommended.arrival)}</strong>
                <span>arrival</span>
              </div>
            </div>
            {plan.advisory && <p className="advisory">{plan.advisory}</p>}
          </div>

          <h2>Compare routes</h2>
          {plan.routes.length < 3 && (
            <p className="hint">
              Only {plan.routes.length} distinct {plan.routes.length === 1 ? 'route' : 'routes'}{' '}
              exist for this trip.
            </p>
          )}
          {plan.routes.map((route) => (
            <RouteCard
              key={route.id}
              route={route}
              recommended={route.id === plan.recommended_route_id}
              selected={route.id === selectedId}
              onSelect={() => onSelect(route.id)}
            />
          ))}

          {selected && <CheckpointList route={selected} onHover={onHoverCheckpoint} />}
        </section>
      )}
    </aside>
  )
}

export default memo(Sidebar)
