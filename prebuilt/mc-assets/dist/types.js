import { z } from 'zod';
// ---
// ItemDefinitionSchema
export const DisplayContext = z.enum([
    'gui',
    'ground',
    'fixed',
    'head',
    'firstperson',
    'thirdperson'
]);
export const ItemPropertyTypes = z.object({
    'minecraft:using_item': z.boolean(),
    'minecraft:use_duration': z.number(), // number of ticks
    'minecraft:display_context': DisplayContext,
    'minecraft:broken': z.boolean(),
    'minecraft:damage': z.number(),
    'minecraft:cooldown': z.number(),
    'minecraft:custom_model_data': z.number(),
    'minecraft:bundle/has_selected_item': z.boolean(),
    'minecraft:trim_material': z.string(),
    'minecraft:use_cycle': z.number(),
    'minecraft:block_state': z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    'minecraft:date': z.date().optional(),
    'minecraft:local_time': z.date().optional(),
    'minecraft:time': z.number().optional(), // Used for clock and other time-based items
    'minecraft:context_dimension': z.string().optional(), // Used for dimension-specific models
    'minecraft:compass': z.number().optional(), // Used for compass direction
    'minecraft:has_component': z.boolean().optional(), // Used for lodestone compass
    // utils properties
    use_duration_ms: z.number().optional(),
});
// Base model types
const constantTint = z.object({
    type: z.literal('minecraft:constant'),
    value: z.number()
});
const baseModel = z.object({
    type: z.literal('minecraft:model'),
    model: z.string(),
    tints: z.array(constantTint).optional()
});
const emptyModel = z.object({
    type: z.literal('minecraft:empty')
});
const specialModel = z.object({
    type: z.literal('minecraft:special'),
    base: z.string(),
    model: z.object({
        type: z.union([
            z.literal('minecraft:conduit'),
            z.literal('minecraft:shield'),
            z.literal('minecraft:head')
        ]),
        kind: z.string().optional() // For head models
    })
});
const selectCase = z.object({
    model: z.lazy(() => modelTypes),
    when: z.array(z.string())
});
const selectModel = z.object({
    type: z.literal('minecraft:select'),
    cases: z.array(selectCase),
    fallback: z.lazy(() => modelTypes).optional(),
    property: z.string(),
    pattern: z.string().optional()
});
const rangeEntry = z.object({
    model: z.lazy(() => modelTypes),
    threshold: z.number()
});
const rangeDispatchModel = z.object({
    type: z.literal('minecraft:range_dispatch'),
    entries: z.array(rangeEntry),
    fallback: z.lazy(() => modelTypes),
    property: z.string(),
    scale: z.number().optional(),
    source: z.string().optional(),
    target: z.string().optional()
});
const conditionModel = z.object({
    type: z.literal('minecraft:condition'),
    property: z.string(),
    on_true: z.lazy(() => modelTypes),
    on_false: z.lazy(() => modelTypes)
});
const compositeModel = z.object({
    type: z.literal('minecraft:composite'),
    models: z.array(z.lazy(() => modelTypes))
});
const dateCondition = z.object({
    month: z.number(),
    days: z.array(z.number())
});
const dateModel = z.object({
    type: z.literal('minecraft:date'),
    conditions: z.array(dateCondition),
    on_match: z.lazy(() => modelTypes),
    fallback: z.lazy(() => modelTypes)
});
// Combined model types
const modelTypes = z.discriminatedUnion('type', [
    baseModel,
    emptyModel,
    specialModel,
    selectModel,
    rangeDispatchModel,
    conditionModel,
    compositeModel,
    dateModel
]);
// Main schema
export const ItemDefinitionSchema = z.object({
    model: modelTypes,
    disable_hand_animation: z.boolean().optional()
});
