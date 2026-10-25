'use strict'
// Vanilla calls java.lang.Math directly in places (the elytra lift's Math.cos since 1.18.2), and V8's sin and cos
// differ from Java's in the last bit on about 3% of inputs. Requiring this installs Java's own in
// mineflayer-physics-utils when the java-math addon is built, and warns once when it is not.
const { setJavaTrig } = require('@nxg-org/mineflayer-physics-util')
const javaMath = require('java-math').load()

if (javaMath) setJavaTrig(javaMath)
else console.warn('mineflayer-replay: java-math is not built (pnpm --filter java-math build), so sin and cos are V8\'s and can miss Java\'s by one bit')
