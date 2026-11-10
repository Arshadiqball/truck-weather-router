import { useEffect, useId, useRef, useState } from 'react'

import { searchPlaces } from '../lib/api'
import type { Place } from '../lib/types'

interface Props {
  label: string
  placeholder: string
  value: Place | null
  onChange: (place: Place | null) => void
}

const DEBOUNCE_MS = 300

export default function PlaceInput({ label, placeholder, value, onChange }: Props) {
  const id = useId()
  const [text, setText] = useState(value?.label ?? '')
  const [options, setOptions] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [searching, setSearching] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  // keep the box in sync when the parent sets a place (e.g. sample trips)
  useEffect(() => {
    if (value) setText(value.label)
  }, [value])

  useEffect(() => {
    const query = text.trim()
    if (query.length < 3 || query === value?.label) {
      setOptions([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(() => {
      searchPlaces(query, controller.signal)
        .then((places) => {
          setOptions(places)
          setActive(0)
          setSearching(false)
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            setOptions([])
            setSearching(false)
          }
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [text, value])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const choose = (place: Place) => {
    onChange(place)
    setText(place.label)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || !options.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + options.length) % options.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(options[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showList = open && text.trim().length >= 3 && !value

  return (
    <div className="field place-input" ref={wrapper}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          if (value) onChange(null)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
      />
      {showList && (
        <ul className="place-options" id={`${id}-list`} role="listbox">
          {options.map((place, i) => (
            <li
              key={`${place.lat},${place.lon}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(place)
              }}
            >
              {place.label}
            </li>
          ))}
          {!options.length && (
            <li className="muted">{searching ? 'Searching…' : 'No places found'}</li>
          )}
        </ul>
      )}
    </div>
  )
}
