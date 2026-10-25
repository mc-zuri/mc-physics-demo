'use strict'
// java.lang.Math.sin and cos, called through JNI in a JVM embedded in this process. V8's Math.sin and Math.cos differ
// from HotSpot's in the last bit on about 3% of inputs (cos(56 degrees as a float in radians) is 0.5591928973939152
// in Java, 0.5591928973939153 in V8), so replaying the vanilla client bit for bit needs Java's own.
//
// The addon is opt-in: `pnpm --filter java-math build` (needs a JDK and a C++ toolchain). load() starts the JDK it
// was built against, or the one at $JAVA_MATH_HOME. One JVM per process; each forked process starts its own.
const fs = require('fs')
const path = require('path')

const BUILD = path.join(__dirname, 'build')
const ADDON = path.join(BUILD, 'Release', 'java_math.node')
const JVM_LIBRARY = {
  win32: ['bin/server/jvm.dll', 'bin/client/jvm.dll'],
  darwin: ['lib/server/libjvm.dylib'],
  linux: ['lib/server/libjvm.so']
}[process.platform] ?? ['lib/server/libjvm.so']

function isBuilt () {
  return fs.existsSync(ADDON)
}

function builtJavaHome () {
  return JSON.parse(fs.readFileSync(path.join(BUILD, 'jdk.json'), 'utf8')).javaHome
}

function jvmLibrary (javaHome) {
  const found = JVM_LIBRARY.map(file => path.join(javaHome, file)).find(file => fs.existsSync(file))
  if (!found) throw new Error(`java-math: no JVM library (${JVM_LIBRARY.join(' or ')}) under ${javaHome}`)
  return fs.realpathSync(found)
}

let loaded

/**
 * Java's Math: { sin, cos, runtime (java.runtime.version), javaHome }, or null when the addon is not built.
 * Throws when the addon is built but its JVM cannot start: a replay that asked for Java's math never falls back.
 */
function load () {
  if (loaded !== undefined) return loaded
  if (!isBuilt()) return null
  const javaHome = process.env.JAVA_MATH_HOME || builtJavaHome()
  const native = require(ADDON)
  const runtime = native.initialize(jvmLibrary(javaHome))
  loaded = { sin: native.sin, cos: native.cos, runtime, javaHome }
  return loaded
}

module.exports = { load, isBuilt }
