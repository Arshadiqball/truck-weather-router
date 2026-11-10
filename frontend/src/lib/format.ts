const dayTime = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

const dayHour = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function formatDayTime(value: string | number | Date) {
  return dayTime.format(new Date(value))
}

export function formatDayHour(value: string | number | Date) {
  return dayHour.format(new Date(value))
}

export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} min`
}

export function formatMiles(miles: number) {
  return `${Math.round(miles).toLocaleString()} mi`
}

// Value for <input type="datetime-local">, in the browser's own timezone.
export function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
