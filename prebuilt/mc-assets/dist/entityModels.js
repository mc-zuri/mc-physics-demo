import { VersionedStore } from './versionedStore';
/**
 * The export a world version reads (dist/entityModels/<export>.json): the newest export not newer than it, else the
 * oldest export.
 */
export const entityModelsExportFor = (versions, version) => {
    const sorted = [...versions].sort((a, b) => semverNumber(a) - semverNumber(b));
    let result = sorted[0];
    for (const exported of sorted)
        if (semverNumber(exported) <= semverNumber(version))
            result = exported;
    return result;
};
const semverNumber = (version) => {
    const [x, y = '0', z = '0'] = version.split('.');
    return +`${x.padStart(2, '0')}${y.padStart(2, '0')}${z.padStart(2, '0')}`;
};
export class EntityModelsStore {
    models = new VersionedStore();
    entities = new VersionedStore();
    animations = new VersionedStore();
    paintings = new VersionedStore();
    trims = new VersionedStore();
    versions;
    constructor(data) {
        this.versions = data.versions;
        for (const store of [this.models, this.entities, this.animations, this.paintings, this.trims])
            store.inclusive = false;
        this.models.loadData(data.models);
        this.entities.loadData(data.entities);
        this.animations.loadData(data.animations);
        this.paintings.loadData((data.paintings ?? { latest: {} }));
        this.trims.loadData((data.trims ?? { latest: {} }));
    }
    /** How the version names trim textures (1.19.4+). */
    getTrims(version) {
        return this.trims.get(version, 'trims');
    }
    /** How the version draws paintings. */
    getPaintings(version) {
        return this.paintings.get(version, 'paintings');
    }
    /** The oldest exported version is used for older versions. */
    getEntity(version, name) {
        return this.entities.get(version, name);
    }
    getModel(version, layer) {
        return this.models.get(version, layer);
    }
    getAnimation(version, name) {
        return this.animations.get(version, name);
    }
}
const toNumber = (value) => {
    if (typeof value === 'number')
        return value;
    if (typeof value === 'boolean')
        return value ? 1 : 0;
    if (typeof value === 'bigint')
        return Number(value);
    if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value)))
        return Number(value);
    return undefined;
};
export const conditionHolds = (condition, entity, input) => {
    if ('slot' in condition) {
        const item = input.equipment?.[condition.slot];
        return !!item && item.replace(/^minecraft:/, '') === condition.item;
    }
    const raw = input.metadata?.[condition.index];
    const fallback = entity.defaults?.[String(condition.index)];
    let value = raw === undefined || raw === null ? fallback : raw;
    if (condition.field && value && typeof value === 'object')
        value = value[condition.field];
    if (condition.notDefault) {
        return value !== undefined && value !== null && String(value) !== String(fallback) && String(value) !== '-1';
    }
    if (typeof condition.value === 'boolean')
        return value === condition.value || toNumber(value) === (condition.value ? 1 : 0);
    if (typeof value === 'string' && condition.name !== undefined && isNaN(Number(value)))
        return value === condition.name;
    const number = toNumber(value);
    if (number === undefined)
        return false;
    if (condition.mask !== undefined)
        return (number & condition.mask) === condition.value;
    return number === condition.value;
};
/**
 * The entries an entity draws: the default look, with the patch of every state whose conditions all hold applied in
 * order of how many conditions it has (fewest first, file order among equals). Keys are kept so a renderer can tell
 * the entries apart (`<layer><part>#<n>`, `block#n`, `item#n`, `custom#n`).
 */
export const composeEntityLook = (entity, input = {}) => {
    const look = new Map();
    const [first, ...rest] = entity.states;
    if (!first?.look)
        return [];
    for (const [key, entry] of Object.entries(first.look))
        look.set(key, structuredClone(entry));
    const matching = rest
        .map((state, index) => ({ state, index }))
        .filter(({ state }) => state.when.every(condition => conditionHolds(condition, entity, input)))
        .sort((a, b) => a.state.when.length - b.state.when.length || a.index - b.index);
    for (const { state } of matching)
        applyEntityPatch(look, state.patch ?? {});
    return [...look].map(([key, entry]) => ({ key, entry: entry }));
};
export const applyEntityPatch = (look, patch) => {
    for (const [key, change] of Object.entries(patch)) {
        if (change === null) {
            look.delete(key);
            continue;
        }
        const current = look.get(key);
        if (!current) {
            if ('type' in change)
                look.set(key, structuredClone(change));
            continue;
        }
        for (const [property, value] of Object.entries(change)) {
            if (value === null)
                delete current[property];
            else
                current[property] = structuredClone(value);
        }
    }
};
const semver = (version) => {
    const [x, y = '0', z = '0'] = version.split('.');
    return +`${x.padStart(2, '0')}${y.padStart(2, '0')}${z.padStart(2, '0')}`;
};
/**
 * The other-textures folder a version reads a texture from: the oldest version key above it that holds a copy, else
 * latest (dist/other-textures/<folder>/<path>.png).
 */
export const entityTextureFolder = (data, texture, version) => {
    const path = texture.replace(/^minecraft:/, '');
    const versions = data.textureVersions?.[path];
    if (!versions?.length || !version)
        return 'latest';
    const sorted = [...versions].sort((a, b) => semver(a) - semver(b));
    return sorted.find(key => semver(version) < semver(key)) ?? 'latest';
};
const trimIndex = (list, value) => {
    if (typeof value === 'number')
        return list[value] ? value : -1;
    const id = value.includes(':') ? value : `minecraft:${value}`;
    return list.findIndex(entry => entry.id === id || entry.asset === id);
};
/**
 * The texture of a trim on a piece (its layer and asset, {@link EntityArmorTrim}): the pattern's asset under the layer's
 * prefix, then the material's suffix, or its override for the asset (iron trims on iron armor: iron_darker); undefined
 * when the trim names no exported pattern or material.
 */
export const trimTexture = (trims, trim, layer, asset) => {
    const pattern = trims.patterns[trimIndex(trims.patterns, trim.pattern)];
    const material = trims.materials[trimIndex(trims.materials, trim.material)];
    const names = trims.layers[layer];
    if (!pattern || !material || !names)
        return undefined;
    const [namespace, path] = pattern.asset.includes(':') ? pattern.asset.split(':') : ['minecraft', pattern.asset];
    return `${namespace}:${names.prefix}${path}${names.separator}${material.overrides?.[asset] ?? material.suffix}`;
};
/**
 * The armor entries an entity draws for what it wears, keyed armor/<slot>/<key>: the pieces exported for it (a baby's
 * when its metadata says it is one), a dyed piece's dyeable entries tinted with its color (RGB), then a trimmed piece's
 * trim (armor/<slot>/trim/<key>), each a copy of the piece's entry it names with the trim's texture and render type.
 */
export const composeEntityArmor = (entity, equipment = {}, colors = {}, trims = {}, trimsData, input = {}) => {
    const result = [];
    // a baby wears its own armor (the first variant whose conditions hold)
    const armor = entity.armorVariants?.find(variant => variant.when.every(condition => conditionHolds(condition, entity, input)))?.armor ?? entity.armor;
    for (const [slot, items] of Object.entries(armor ?? {})) {
        const item = equipment[slot]?.replace(/^minecraft:/, '');
        const piece = item ? items[item] : undefined;
        if (!piece)
            continue;
        const color = colors[slot];
        for (const [key, entry] of Object.entries(piece.entries)) {
            const tinted = color !== undefined && piece.dyeable?.includes(key) ? { ...entry, tint: (0xff_00_00_00 | color) >> 0 } : entry;
            result.push({ key: `armor/${slot}/${key}`, entry: tinted });
        }
        const trim = trims[slot];
        if (!trim || !piece.trim || !trimsData)
            continue;
        const texture = trimTexture(trimsData, trim, piece.trim.layer, piece.trim.asset);
        if (!texture)
            continue;
        const decal = !!trimsData.patterns[trimIndex(trimsData.patterns, trim.pattern)]?.decal;
        for (const [key, copied] of Object.entries(piece.trim.entries)) {
            const { texture: _texture, renderType: _renderType, tint: _tint, ...geometry } = piece.entries[copied];
            result.push({ key: `armor/${slot}/trim/${key}`, entry: { ...geometry, texture, renderType: decal ? trimsData.renderTypes.decal : trimsData.renderTypes.normal } });
        }
    }
    return result;
};
/** The head layer's look for the entity's metadata: the default, with every variant whose conditions hold (fewest first); undefined when hidden. */
export const entityHeadLook = (entity, input = {}) => {
    const head = entity.head;
    if (!head)
        return undefined;
    const look = { anchor: head.anchor, skulls: head.skulls, item: head.item, worn: head.worn };
    const variants = (head.variants ?? [])
        .map((variant, index) => ({ variant, index }))
        .filter(({ variant }) => variant.when.every(condition => conditionHolds(condition, entity, input)))
        .sort((a, b) => a.variant.when.length - b.variant.when.length || a.index - b.index);
    for (const { variant } of variants) {
        if (variant.hidden)
            return undefined;
        for (const key of ['anchor', 'skulls', 'item', 'worn']) {
            if (!(key in variant))
                continue;
            const value = variant[key];
            if (value === null)
                delete look[key];
            else
                look[key] = value;
        }
    }
    return look;
};
/**
 * What the head layer draws for the item an entity wears on its head (minecraft-data's name, the damage value before
 * 1.13 for skulls): a skull's entries, or the item as an item. Head armor the export draws as armor, and before 1.9 items
 * that are no blocks (isBlock), draw nothing here.
 */
export const composeEntityHead = (entity, input, item, isBlock = true) => {
    const look = entityHeadLook(entity, input);
    if (!look)
        return undefined;
    const name = item.name.replace(/^minecraft:/, '');
    const skull = look.skulls[name] ?? look.skulls[`${name}:${item.metadata ?? 0}`];
    if (skull)
        return { anchor: look.anchor, entries: Object.entries(skull).map(([key, entry]) => ({ key, entry })), worn: look.worn?.skull };
    if (entity.armor?.head?.[name] || !look.item)
        return undefined;
    if (look.item.items === 'blocks' && !isBlock)
        return undefined;
    return { anchor: look.anchor, item: { transform: look.item.transform, context: look.item.context }, worn: look.worn?.item };
};
/** The painting variant of a network id (registry id, or index), or of an id or title. */
export const paintingVariant = (paintings, variant) => {
    if (variant === undefined || variant === null)
        return undefined;
    if (typeof variant === 'number')
        return paintings.variants[variant];
    const id = variant.includes(':') || variant !== variant.toLowerCase() ? variant : `minecraft:${variant}`;
    return paintings.variants.find(v => v.id === variant || v.id === id || v.id.toLowerCase() === variant.toLowerCase());
};
/** Equipment slot names in the order of the game's EquipmentSlot (the protocol's slot ids). */
export const ENTITY_EQUIPMENT_SLOTS = ['mainhand', 'offhand', 'feet', 'legs', 'chest', 'head', 'body', 'saddle'];
