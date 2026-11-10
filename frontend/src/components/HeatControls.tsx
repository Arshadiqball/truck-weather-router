import { useEffect, useRef } from 'react'

import { formatDayHour } from '../lib/format'
import { HEAT_LAYERS, LEVELS } from '../lib/risk'
import type { HeatLayer } from '../lib/types'

const HOURS_PER_SECOND = 4

interface Props {
  hours: number[] // unix seconds for each forecast hour
  hour: number
  onHourChange: (hour: number) => void
  layer: HeatLayer
  onLayerChange: (layer: HeatLayer) => void
  visible: boolean
  onVisibleChange: (visible: boolean) => void
  playing: boolean
  onPlayingChange: (playing: boolean) => void
}

export default function HeatControls(props: Props) {
  const { hours, hour, onHourChange, layer, onLayerChange, visible, onVisibleChange } = props
  const { playing, onPlayingChange } = props
  const lastHour = hours.length - 1

  // The animation loop reads the current hour from a ref so it doesn't have
  // to be torn down and restarted on every frame.
  const hourRef = useRef(hour)
  hourRef.current = hour

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const next = hourRef.current + ((now - previous) / 1000) * HOURS_PER_SECOND
      previous = now
      onHourChange(next >= lastHour ? 0 : next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, lastHour, onHourChange])

  const whole = Math.min(Math.round(hour), lastHour)
  const legend = HEAT_LAYERS.find((l) => l.id === layer)!

  return (
    <div className={`heat-controls${visible ? '' : ' off'}`}>
      <div className="heat-top">
        <label className="switch">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => {
              onVisibleChange(e.target.checked)
              if (!e.target.checked) onPlayingChange(false)
            }}
          />
          Weather heatmap
        </label>
        <div className="segmented small">
          {HEAT_LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={l.id === layer ? 'on' : ''}
              aria-pressed={l.id === layer}
              disabled={!visible}
              onClick={() => onLayerChange(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="heat-slider">
        <button
          type="button"
          className="play"
          disabled={!visible}
          aria-label={playing ? 'Pause forecast' : 'Play forecast'}
          onClick={() => onPlayingChange(!playing)}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={lastHour}
          step={0.25}
          value={hour}
          disabled={!visible}
          aria-label="Forecast hour"
          onChange={(e) => {
            onPlayingChange(false)
            onHourChange(Number(e.target.value))
          }}
        />
        <div className="heat-time">
          <strong>{whole === 0 ? 'Now' : `+${whole} h`}</strong>
          <span>{formatDayHour(hours[whole] * 1000)}</span>
        </div>
      </div>

      <div className="heat-legend">
        {LEVELS.map((l, i) => (
          <span key={l.id}>
            <i style={{ background: l.color }} />
            {legend.bands[i]}
          </span>
        ))}
        {legend.unit && <em>{legend.unit}</em>}
      </div>
    </div>
  )
}
