'use strict'
// Exact comparison: numbers by Object.is (a -0 the client sends is other bytes than a 0), the rest by ===.
const { Vec3 } = require('vec3')

function valueOf (state, field) {
  const value = state[field]
  return value instanceof Vec3 ? [value.x, value.y, value.z] : value
}

function differences (actual, expected, fields) {
  const out = []
  for (const field of fields) {
    const want = expected[field]
    if (want === undefined) continue
    const have = valueOf(actual, field)
    if (Array.isArray(want)) {
      want.forEach((w, i) => {
        if (!Object.is(have?.[i], w)) out.push({ field: `${field}.${'xyz'[i]}`, expected: w, actual: have?.[i] })
      })
    } else if (!Object.is(have, want)) {
      out.push({ field, expected: want, actual: have })
    }
  }
  return out
}

const keysOf = input => Object.keys(input).filter(key => input[key] === true).join('+') || 'no keys'

// "<case> on <version>: N of M ticks differ; first at tick T (forward+jump, yaw 0, pitch 0)" and one line per field.
function report (version, name, { ticks, divergences }) {
  if (!divergences.length) return `${name} on ${version}: all ${ticks} ticks match`
  const first = divergences[0]
  const lines = [`${name} on ${version}: ${divergences.length} of ${ticks} ticks differ; first at tick ${first.t} (${keysOf(first.input)}, yaw ${first.input.yaw}, pitch ${first.input.pitch})`]
  for (const { field, expected, actual } of first.diffs) {
    const delta = typeof expected === 'number' && typeof actual === 'number' ? ` (Δ ${(actual - expected).toExponential(3)})` : ''
    lines.push(`  ${field}: vanilla ${expected} ours ${actual}${delta}`)
  }
  return lines.join('\n')
}

// Decoded packets ({ name, params }) compared field by field, exactly (numbers by Object.is, buffers by bytes; a field
// left undefined is a field not written).
function fieldDifferences (expected, actual, path = '') {
  if (Object.is(expected, actual)) return []
  if (Buffer.isBuffer(expected) && Buffer.isBuffer(actual)) return expected.equals(actual) ? [] : [{ path, expected, actual }]
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
    const out = []
    for (const key of keys) {
      if (expected[key] === undefined && actual[key] === undefined) continue
      out.push(...fieldDifferences(expected[key], actual[key], path ? `${path}.${key}` : key))
    }
    return out
  }
  return [{ path, expected, actual }]
}

const jsonOf = value => JSON.stringify(value, (key, v) => typeof v === 'bigint' ? `${v}n` : v?.type === 'Buffer' && Array.isArray(v.data) ? Buffer.from(v.data).toString('hex') : v)

// (a -0 is shown as one: it is other bytes than 0)
const valueText = value => Object.is(value, -0) ? '-0' : jsonOf(value)

// "block_dig{status:0,location:{x:2,y:101,z:2854},face:4,sequence:1}", long fields cut
function brief ({ name, params }) {
  const text = jsonOf(params ?? {})?.replace(/"([A-Za-z0-9_]+)":/g, '$1:') ?? ''
  return `${name}${text.length > 200 ? text.slice(0, 197) + '...' : text}`
}

// A packet's fields with what has no order in the client put in one: the enchantments of a stack (1.20.5 - 1.21.4 write
// them in full; ItemEnchantments keeps them in an Object2IntOpenHashMap keyed by the enchantment's Holder, whose hash is
// its identity hash, so the client writes them in an order no two runs share), sorted by id; and from 1.21.5 the
// components of a stack sent as hashes (HashedPatchMap: an IdentityHashMap of the added ones, a HashSet of the removed
// ones, both keyed by the component type's identity), sorted by type
const byType = (a, b) => String(a?.type) < String(b?.type) ? -1 : String(a?.type) > String(b?.type) ? 1 : 0
function canonical (value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value
  const out = {}
  for (const [key, field] of Object.entries(value)) out[key] = canonical(field)
  if ((value.type === 'enchantments' || value.type === 'stored_enchantments') && Array.isArray(out.data?.enchantments)) {
    out.data = { ...out.data, enchantments: [...out.data.enchantments].sort((a, b) => a.id - b.id) }
  }
  if (Array.isArray(out.components) && out.components.every(component => component && 'hash' in component)) {
    out.components = [...out.components].sort(byType)
    if (Array.isArray(out.removeComponents)) out.removeComponents = [...out.removeComponents].sort(byType)
  }
  return out
}

// The first difference of two packet lists, as a line: a packet of another name, one missing or extra, or the first
// field that differs (enchantments in any order: canonical)
function packetListDifference (expected, actual) {
  for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
    const want = expected[i] && { ...expected[i], params: canonical(expected[i].params) }
    const have = actual[i] && { ...actual[i], params: canonical(actual[i].params) }
    if (!want) return `#${i + 1}: extra ${brief(have)}`
    if (!have) return `#${i + 1}: missing ${brief(want)}`
    if (want.name !== have.name) return `#${i + 1}: vanilla ${want.name}, ours ${have.name}`
    const [diff] = fieldDifferences(want.params, have.params)
    if (diff) return `#${i + 1} ${want.name}.${diff.path}: vanilla ${valueText(diff.expected)} ours ${valueText(diff.actual)}`
  }
  return null
}

// "<case> on <version>: interaction differs in N of M ticks; first at tick T (keys...)", then vanilla's packets and
// ours that tick, the first difference, and what mineflayer has no API for
function interactionReport (version, name, { ticks, interaction, unsupported = [] }) {
  if (!interaction.length) return `${name} on ${version}: the interaction packets of all ${ticks} ticks match`
  const first = interaction[0]
  const list = packets => packets.map(brief).join(' ') || '(none)'
  const lines = [
    `${name} on ${version}: interaction differs in ${interaction.length} of ${ticks} ticks; first at tick ${first.t} (${keysOf(first.input)}, yaw ${first.input.yaw}, pitch ${first.input.pitch})`,
    `  vanilla: ${list(first.expected)}`,
    `  ours:    ${list(first.actual)}`,
    `  first difference: ${first.difference}`
  ]
  if (interaction.length > 1) lines.push(`  then ticks ${interaction.slice(1, 12).map(d => d.t).join(', ')}${interaction.length > 12 ? ', ...' : ''}`)
  for (const { t, action, reason } of unsupported.slice(0, 8)) lines.push(`  unsupported at tick ${t}: ${action} (${reason})`)
  return lines.join('\n')
}

module.exports = { differences, report, fieldDifferences, packetListDifference, interactionReport, brief }
