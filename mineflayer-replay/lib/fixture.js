'use strict'
// Fixtures written by tools/import.js: fixtures/java/<version>.json.gz, one per tested version.
//
// A case is the player state before its first tick (`start`) and per client tick the input (`in`: keys held, yaw and
// pitch in vanilla degrees) and the state after the tick. Rows hold only what changed since the row before; events
// (EVENTS) belong to their own row only. Doubles are written by Java's Double.toString and parse to the same double;
// floats are written by Float.toString, so FLOATS are rounded back to floats here.
//
// A fixture with `fixtureFormat: 2` is smaller on disk and load() gives the same objects back: a row's field whose
// value and the value before it (the row before's, or the start's) are both objects holds only delta(value, before)
// (netState, in, attributes, the vehicle), and packet bytes of BLOB_MIN bytes or more are '@<index>' into the
// fixture's `blobs` list (each chunk once per version).
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DIR = process.env.REPLAY_FIXTURES ? path.resolve(process.env.REPLAY_FIXTURES) : path.resolve(__dirname, '../../fixtures/java')

// What the server sent before a tick or what the client sent during it: never filled forward.
const EVENTS = ['velocityPackets', 'blockChanges', 'vehicleServer', 'vehicleRearing', 'explosionKnockback', 'corrected', 'serverPackets', 'clientPackets']

// Fields vanilla keeps as Java floats.
const FLOATS = ['yaw', 'pitch', 'xxa', 'yya', 'zza', 'speed']
const NET_FLOATS = ['lastYaw', 'lastPitch']

const FORMAT = 2
const BLOB_MIN = 1024
const BLOB = '@'
const DEL = '$del'

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

function same (a, b) {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]))
}

// The keys of value that differ from base (objects as their own delta), and $del: the keys base has and value lacks.
function delta (value, base) {
  const out = {}
  for (const [key, v] of Object.entries(value)) {
    if (key === DEL) throw new Error(`a recorded object has a key named ${DEL}`)
    if (!Object.hasOwn(base, key)) out[key] = v
    else if (!same(v, base[key])) out[key] = isObject(v) && isObject(base[key]) ? delta(v, base[key]) : v
  }
  const gone = Object.keys(base).filter(key => !Object.hasOwn(value, key))
  if (gone.length) out[DEL] = gone
  return out
}

function patch (base, change) {
  const out = { ...base }
  for (const [key, v] of Object.entries(change)) {
    if (key !== DEL) out[key] = isObject(v) && isObject(base[key]) ? patch(base[key], v) : v
  }
  for (const key of change[DEL] ?? []) delete out[key]
  return out
}

// A fixtureFormat 2 fixture as the rows were before: whole object fields, packet bytes inline.
function decode (fixture) {
  const blobs = fixture.blobs ?? []
  const bytes = hex => {
    if (typeof hex !== 'string' || !hex.startsWith(BLOB)) return hex
    const found = blobs[hex.slice(BLOB.length)]
    if (found === undefined) throw new Error(`${fixture.version}: no blob ${hex}`)
    return found
  }
  for (const rec of fixture.cases) {
    let last = rec.start
    for (const row of rec.ticks) {
      for (const [key, value] of Object.entries(row)) {
        if (key === 't' || EVENTS.includes(key)) continue
        if (isObject(value) && isObject(last[key])) row[key] = patch(last[key], value)
      }
      for (const packet of row.serverPackets ?? []) {
        if (Object.hasOwn(packet, 'bytes')) packet.bytes = bytes(packet.bytes)
        for (const part of packet.packets ?? []) if (Object.hasOwn(part, 'bytes')) part.bytes = bytes(part.bytes)
      }
      last = { ...last, ...row }
    }
  }
  delete fixture.fixtureFormat
  delete fixture.blobs
  return fixture
}

function versions () {
  if (!fs.existsSync(DIR)) return []
  return fs.readdirSync(DIR).filter(f => f.endsWith('.json.gz')).map(f => f.slice(0, -'.json.gz'.length))
}

const loaded = new Map()
function load (version) {
  if (!loaded.has(version)) {
    const file = path.join(DIR, `${version}.json.gz`)
    if (!fs.existsSync(file)) {
      loaded.set(version, null)
    } else {
      const fixture = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)))
      if (fixture.fixtureFormat === FORMAT) decode(fixture)
      else if (fixture.fixtureFormat !== undefined) throw new Error(`${file}: unknown fixtureFormat ${fixture.fixtureFormat}`)
      fixture.byName = new Map(fixture.cases.map(c => [c.name, c]))
      loaded.set(version, fixture)
    }
  }
  return loaded.get(version)
}

function scenario (version, name) {
  return load(version)?.byName.get(name) ?? null
}

function roundFloats (state) {
  for (const key of FLOATS) if (typeof state[key] === 'number') state[key] = Math.fround(state[key])
  if (state.in) state.in = roundInput(state.in)
  if (state.netState) {
    state.netState = { ...state.netState }
    for (const key of NET_FLOATS) if (typeof state.netState[key] === 'number') state.netState[key] = Math.fround(state.netState[key])
  }
  return state
}

function roundInput (input) {
  const out = { ...input }
  if (typeof out.yaw === 'number') out.yaw = Math.fround(out.yaw)
  if (typeof out.pitch === 'number') out.pitch = Math.fround(out.pitch)
  return out
}

// The start state with its floats.
function start (rec) {
  return roundFloats({ ...rec.start })
}

// Every row complete: the fields carried forward from the start and the rows before, the row's own events under
// `events`.
function expand (rec) {
  let last = start(rec)
  return rec.ticks.map(row => {
    const state = {}
    const events = {}
    for (const [key, value] of Object.entries(row)) (EVENTS.includes(key) ? events : state)[key] = value
    last = roundFloats({ ...last, ...state })
    return { ...last, events }
  })
}

const bytesOf = hex => Buffer.from(hex, 'hex')

module.exports = { DIR, EVENTS, FLOATS, FORMAT, BLOB, BLOB_MIN, versions, load, scenario, start, expand, bytesOf, delta, patch, decode }
