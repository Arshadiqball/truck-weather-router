import type { HeatLayer, RiskLevel } from './types'

export const LEVELS: { id: RiskLevel; label: string; color: string }[] = [
  { id: 'low', label: 'Low', color: '#34d399' },
  { id: 'moderate', label: 'Moderate', color: '#fbbf24' },
  { id: 'high', label: 'High', color: '#fb923c' },
  { id: 'severe', label: 'Severe', color: '#f43f5e' },
  { id: 'no_travel', label: 'No Travel', color: '#c026d3' },
]

export const UNKNOWN_COLOR = '#7c879c'

const byId = Object.fromEntries(LEVELS.map((l) => [l.id, l]))

export function levelColor(level: RiskLevel | null | undefined) {
  return level ? byId[level].color : UNKNOWN_COLOR
}

export function levelLabel(level: RiskLevel | null | undefined) {
  return level ? byId[level].label : 'No forecast'
}

// Legend text for each heatmap layer, one entry per risk band.
export const HEAT_LAYERS: { id: HeatLayer; label: string; unit: string; bands: string[] }[] = [
  { id: 'risk', label: 'Risk', unit: '', bands: LEVELS.map((l) => l.label) },
  { id: 'wind', label: 'Wind', unit: 'mph', bands: ['<25', '25–34', '35–44', '45–54', '55+'] },
  { id: 'rain', label: 'Rain', unit: 'in/hr', bands: ['<0.10', '0.10+', '0.25+', '0.50+', '>1.00'] },
  { id: 'snow', label: 'Snow', unit: 'in/hr', bands: ['<0.5', '0.5+', '1.0+', '2.0+', '>3.0'] },
]
