'use strict'
// Which recorded cases each replay layer runs, and the known failures it expects.
const fs = require('fs')
const path = require('path')
const fixtures = require('./fixture')
const { testedVersions } = require('mineflayer/lib/version')

const KNOWN_FAILURES = path.join(__dirname, '..', 'known-failures.json')

// The engine replays the player on foot and the vehicles the riding cases steered (v_*), not the mineflayer feature
// cases (m_*, mk_*).
const engineCase = name => !/^mk?_/.test(name)
// The bot replays every case but the kick (mk_*), riding (v_*) included; the feature cases' movement counts too.
const botCase = name => !/^mk_/.test(name)

// Releases recorded but not tested by mineflayer yet: the engine replays them, the bot from when mineflayer tests them.
const UNTESTED_RELEASES = ['26.1', '26.2', '26.3']

// The versions a layer replays, oldest first: mineflayer's tested versions, and for the engine the newer releases.
// REPLAY_VERSIONS (comma separated, e.g. "26.3,1.21.11") narrows them: a run that loads only those fixtures.
function versions (layer) {
  const available = new Set(fixtures.versions())
  const only = process.env.REPLAY_VERSIONS ? new Set(process.env.REPLAY_VERSIONS.split(',').map(v => v.trim())) : null
  const all = layer === 'engine' ? [...new Set([...testedVersions, ...UNTESTED_RELEASES])] : testedVersions
  return all.filter(v => available.has(v) && (!only || only.has(v)))
}

function casesOf (version, filter) {
  return fixtures.load(version).cases.filter(c => filter(c.name))
}

function knownFailures () {
  if (!fs.existsSync(KNOWN_FAILURES)) return {}
  return JSON.parse(fs.readFileSync(KNOWN_FAILURES, 'utf8'))
}

module.exports = { KNOWN_FAILURES, UNTESTED_RELEASES, engineCase, botCase, versions, casesOf, knownFailures }
