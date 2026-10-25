'use strict'
// Finds the JDK the addon builds against and runs with: $JAVA_HOME, else the java.home of the `java` on the PATH.
// `node scripts/jdk.js home|include|include-platform` prints one path (binding.gyp reads the include directories so).
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function javaHome () {
  if (process.env.JAVA_HOME) return path.resolve(process.env.JAVA_HOME)
  const run = spawnSync('java', ['-XshowSettings:properties', '-version'], { encoding: 'utf8' })
  const home = /^\s*java\.home = (.+)$/m.exec(run.stderr ?? '')
  if (!home) throw new Error('java-math: no JDK found; set JAVA_HOME or put java on the PATH')
  return home[1].trim()
}

function includeDirs (home) {
  const include = path.join(home, 'include')
  const platform = { win32: 'win32', darwin: 'darwin' }[process.platform] ?? process.platform
  if (!fs.existsSync(path.join(include, 'jni.h'))) throw new Error(`java-math: ${home} has no include/jni.h (a JRE, not a JDK?)`)
  return { include, platform: path.join(include, platform) }
}

module.exports = { javaHome, includeDirs }

if (require.main === module) {
  const home = javaHome()
  const dirs = includeDirs(home)
  // forward slashes: gyp reads backslashes as escapes
  const paths = { home, include: dirs.include, 'include-platform': dirs.platform }
  process.stdout.write(paths[process.argv[2]].replace(/\\/g, '/'))
}
