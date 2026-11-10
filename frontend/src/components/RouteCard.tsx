import { formatDayTime, formatDuration, formatMiles } from '../lib/format'
import { LEVELS, UNKNOWN_COLOR, levelColor, levelLabel } from '../lib/risk'
import type { RouteOption } from '../lib/types'

interface Props {
  route: RouteOption
  recommended: boolean
  selected: boolean
  onSelect: () => void
}

export default function RouteCard({ route, recommended, selected, onSelect }: Props) {
  const { summary } = route
  const flagged = LEVELS.filter((l) => l.id !== 'low' && summary.miles[l.id] >= 0.5)

  return (
    <button
      type="button"
      className={`route-card${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="route-head">
        <span className="route-name">{route.name}</span>
        {recommended && <span className="badge">Recommended</span>}
        <span className="route-worst" style={{ color: levelColor(summary.worst) }}>
          {summary.worst ? `Worst: ${levelLabel(summary.worst)}` : 'No forecast'}
        </span>
      </div>
      {route.via && <div className="route-via">via {route.via}</div>}

      <div className="route-stats">
        <span>
          <strong>{formatDuration(route.duration_s)}</strong>
        </span>
        <span>{formatMiles(route.distance_miles)}</span>
        <span>Arrive {formatDayTime(route.arrival)}</span>
      </div>

      <div className="risk-bar" aria-hidden="true">
        {LEVELS.map((l) => (
          <span key={l.id} style={{ flexGrow: summary.miles[l.id], background: l.color }} />
        ))}
        <span style={{ flexGrow: summary.unknown_miles, background: UNKNOWN_COLOR }} />
      </div>

      <div className="route-risk">
        {flagged.length ? (
          flagged.map((l) => (
            <span key={l.id}>
              <i style={{ background: l.color }} />
              {l.label} {formatMiles(summary.miles[l.id])}
            </span>
          ))
        ) : (
          <span>
            <i style={{ background: LEVELS[0].color }} />
            Low risk the whole way
          </span>
        )}
        <span className="avg">Avg risk {summary.avg_risk.toFixed(2)}</span>
      </div>
    </button>
  )
}
