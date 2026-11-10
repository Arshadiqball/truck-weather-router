export type RiskLevel = 'low' | 'moderate' | 'high' | 'severe' | 'no_travel'

export interface Place {
  label: string
  lat: number
  lon: number
}

export interface Weather {
  wind_mph: number
  gust_mph: number | null
  rain_in: number
  snow_in: number
  temp_f: number | null
}

export interface Risk {
  level: RiskLevel
  wind: RiskLevel
  rain: RiskLevel
  snow: RiskLevel
  reason: string
}

export interface Checkpoint {
  index: number
  mile: number
  from_mile: number
  to_mile: number
  lat: number
  lon: number
  eta: string
  // both are null when the forecast doesn't reach that far
  weather: Weather | null
  risk: Risk | null
}

export interface RouteSummary {
  miles: Record<RiskLevel, number>
  unknown_miles: number
  avg_risk: number
  worst: RiskLevel | null
}

export interface RouteOption {
  id: string
  name: string
  via: string
  rank: number
  distance_miles: number
  duration_s: number
  arrival: string
  geometry: [number, number][] // [lon, lat]
  summary: RouteSummary
  checkpoints: Checkpoint[]
}

export interface TripPlan {
  departure: string
  load_lbs: number
  interval_miles: number
  recommended_route_id: string
  reason: string
  advisory: string | null
  routes: RouteOption[]
}

export interface TripRequest {
  origin: Place
  destination: Place
  departure: string
  load_lbs: number
  interval_miles: number
}

export type HeatLayer = 'risk' | 'wind' | 'rain' | 'snow'

export interface HeatCell {
  col: number
  row: number
  risk: (number | null)[]
  wind: (number | null)[]
  rain: (number | null)[]
  snow: (number | null)[]
}

export interface HeatGrid {
  step: number
  west: number
  south: number
  cols: number
  rows: number
  hours: number[] // unix seconds
  cells: HeatCell[]
}
