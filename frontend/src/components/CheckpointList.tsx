import { memo } from 'react'

import { formatDayTime, formatMiles } from '../lib/format'
import { levelColor, levelLabel } from '../lib/risk'
import type { Checkpoint, RouteOption } from '../lib/types'

interface Props {
  route: RouteOption
  onHover: (checkpoint: Checkpoint | null) => void
}

function weatherText(cp: Checkpoint) {
  if (!cp.weather) return 'No forecast yet'
  const parts = [`${Math.round(cp.weather.wind_mph)} mph`]
  if (cp.weather.rain_in > 0) parts.push(`rain ${cp.weather.rain_in.toFixed(2)}″`)
  if (cp.weather.snow_in > 0) parts.push(`snow ${cp.weather.snow_in.toFixed(1)}″`)
  return parts.join(' · ')
}

function CheckpointList({ route, onHover }: Props) {
  const first = route.checkpoints[0]
  const last = route.checkpoints[route.checkpoints.length - 1]

  return (
    <section className="checkpoints">
      <h2>
        {route.name} timeline <span>{route.checkpoints.length} checkpoints</span>
      </h2>

      {/* the whole drive at a glance: one block per checkpoint, sized by the miles it covers */}
      <div className="timeline" onMouseLeave={() => onHover(null)}>
        {route.checkpoints.map((cp) => (
          <span
            key={cp.index}
            style={{ flexGrow: cp.to_mile - cp.from_mile, background: levelColor(cp.risk?.level) }}
            title={`Mile ${Math.round(cp.mile)} · ${formatDayTime(cp.eta)} · ${levelLabel(cp.risk?.level)}`}
            onMouseEnter={() => onHover(cp)}
          />
        ))}
      </div>
      <div className="timeline-axis">
        <span>{formatDayTime(first.eta)}</span>
        <span>{formatMiles(route.distance_miles)}</span>
        <span>{formatDayTime(last.eta)}</span>
      </div>

      <table onMouseLeave={() => onHover(null)}>
        <thead>
          <tr>
            <th>Mile</th>
            <th>ETA</th>
            <th>Wind / precip per hr</th>
            <th>Risk</th>
          </tr>
        </thead>
        <tbody>
          {route.checkpoints.map((cp) => (
            <tr key={cp.index} onMouseEnter={() => onHover(cp)} title={cp.risk?.reason}>
              <td>{Math.round(cp.mile)}</td>
              <td>{formatDayTime(cp.eta)}</td>
              <td>{weatherText(cp)}</td>
              <td>
                <span className="chip" style={{ background: levelColor(cp.risk?.level) }}>
                  {levelLabel(cp.risk?.level)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export default memo(CheckpointList)
