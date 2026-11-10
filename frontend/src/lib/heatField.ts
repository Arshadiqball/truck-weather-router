import { LEVELS } from './risk'
import type { HeatGrid, HeatLayer } from './types'

const LAYERS: HeatLayer[] = ['risk', 'wind', 'rain', 'snow']
const MAX_CANVAS = 480
const LUT_SIZE = 256
const MAX_SCORE = 4

const toRad = (deg: number) => (deg * Math.PI) / 180
const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + toRad(lat) / 2))
const inverseMercatorY = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Colour + alpha for scores 0..4. Calm weather is only a faint tint so the
// basemap and routes stay readable; Moderate and up is clearly visible.
function buildLut() {
  const stops = LEVELS.map((l) => hexToRgb(l.color))
  const lut = new Uint8ClampedArray(LUT_SIZE * 4)
  for (let i = 0; i < LUT_SIZE; i++) {
    const score = (i / (LUT_SIZE - 1)) * MAX_SCORE
    const lo = Math.min(Math.floor(score), MAX_SCORE - 1)
    const t = score - lo
    for (let c = 0; c < 3; c++) {
      lut[i * 4 + c] = stops[lo][c] + (stops[lo + 1][c] - stops[lo][c]) * t
    }
    lut[i * 4 + 3] = 255 * (0.1 + 0.55 * Math.min(score / 2, 1))
  }
  return lut
}

const LUT = buildLut()

/**
 * Draws the forecast grid onto a small canvas that MapLibre stretches over
 * the corridor. The server sends a sparse lat/lon grid; here it is bilinearly
 * interpolated in space and linearly in time so scrubbing the slider is smooth.
 */
export class HeatField {
  readonly canvas: HTMLCanvasElement
  readonly hours: number[]
  // corner coordinates in the order MapLibre wants: NW, NE, SE, SW
  readonly corners: [[number, number], [number, number], [number, number], [number, number]]

  private cols: number
  private rows: number
  private frames: Record<HeatLayer, Float32Array[]>
  private blended: Float32Array
  private image: ImageData
  private ctx: CanvasRenderingContext2D
  private gridX: Float32Array // grid column (fractional) for each canvas column
  private gridY: Float32Array // grid row (fractional) for each canvas row

  constructor(grid: HeatGrid) {
    const { cols, rows, step } = grid
    this.cols = cols
    this.rows = rows
    this.hours = grid.hours

    // Cell centres sit on the grid lines, so the image extends half a cell out.
    const west = grid.west - step / 2
    const east = grid.west + (cols - 0.5) * step
    const south = grid.south - step / 2
    const north = grid.south + (rows - 0.5) * step
    this.corners = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ]

    const scale = Math.max(2, Math.min(16, Math.floor(MAX_CANVAS / Math.max(cols, rows))))
    const width = cols * scale
    const height = rows * scale
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.ctx = this.canvas.getContext('2d')!
    this.image = this.ctx.createImageData(width, height)

    this.gridX = new Float32Array(width)
    for (let x = 0; x < width; x++) {
      this.gridX[x] = (x + 0.5) / scale - 0.5
    }
    // The map stretches the image evenly in Web Mercator, while the grid is
    // evenly spaced in latitude. Work out the latitude of each pixel row.
    const top = mercatorY(north)
    const bottom = mercatorY(south)
    this.gridY = new Float32Array(height)
    for (let y = 0; y < height; y++) {
      const lat = inverseMercatorY(top + ((bottom - top) * (y + 0.5)) / height)
      this.gridY[y] = (lat - grid.south) / step
    }

    this.blended = new Float32Array(cols * rows)
    this.frames = { risk: [], wind: [], rain: [], snow: [] }
    for (const layer of LAYERS) {
      for (let h = 0; h < grid.hours.length; h++) {
        const frame = new Float32Array(cols * rows).fill(NaN)
        for (const cell of grid.cells) {
          const value = cell[layer][h]
          if (value != null) frame[cell.row * cols + cell.col] = value
        }
        this.frames[layer].push(frame)
      }
    }
  }

  get lastHour() {
    return this.hours.length - 1
  }

  draw(layer: HeatLayer, hour: number) {
    const { cols, rows, blended, gridX, gridY } = this
    const frames = this.frames[layer]
    const h = Math.max(0, Math.min(hour, this.lastHour))
    const h0 = Math.floor(h)
    const h1 = Math.min(h0 + 1, this.lastHour)
    const ht = h - h0
    const a = frames[h0]
    const b = frames[h1]
    for (let i = 0; i < blended.length; i++) {
      blended[i] = a[i] + (b[i] - a[i]) * ht
    }

    const { width, height, data } = this.image
    let p = 0
    for (let y = 0; y < height; y++) {
      const gy = gridY[y]
      const r0 = Math.floor(gy)
      const ty = gy - r0
      for (let x = 0; x < width; x++, p += 4) {
        const gx = gridX[x]
        const c0 = Math.floor(gx)
        const tx = gx - c0

        // Bilinear over the four surrounding cells. Cells outside the
        // corridor are missing, which fades the edge out instead of
        // leaving a hard block.
        let sum = 0
        let weight = 0
        for (let dr = 0; dr < 2; dr++) {
          const r = r0 + dr
          if (r < 0 || r >= rows) continue
          const wy = dr ? ty : 1 - ty
          for (let dc = 0; dc < 2; dc++) {
            const c = c0 + dc
            if (c < 0 || c >= cols) continue
            const v = blended[r * cols + c]
            if (v !== v) continue // NaN
            const w = wy * (dc ? tx : 1 - tx)
            sum += v * w
            weight += w
          }
        }

        if (weight < 0.01) {
          data[p + 3] = 0
          continue
        }
        const score = Math.min(sum / weight, MAX_SCORE)
        const k = Math.round((score / MAX_SCORE) * (LUT_SIZE - 1)) * 4
        data[p] = LUT[k]
        data[p + 1] = LUT[k + 1]
        data[p + 2] = LUT[k + 2]
        data[p + 3] = LUT[k + 3] * Math.min(weight * 1.5, 1)
      }
    }
    this.ctx.putImageData(this.image, 0, 0)
  }
}
