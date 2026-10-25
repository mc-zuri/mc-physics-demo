/**
 * Entity models exported from the game by minecraft-model-generator (custom/entities/<version>/entityModels.json),
 * merged by version into dist/entityModels.json.
 *
 * Geometry is in model space, as the game's layer definitions: pixels, y down, rotations in radians. A model is a part
 * tree: every part has an initial pose and cubes given as the arguments of the game's cube constructor. An entity has
 * states: a default look, and patches with conditions on the entity's synched data (the metadata a client gets) and
 * equipment. See {@link composeEntityLook} for how they combine.
 */
/** x, y, z, xRot, yRot, zRot: ModelPart.translateAndRotate translates by x/16.. then rotates rotationZYX(zRot, yRot, xRot). */
export type EntityPartPose = [number, number, number, number, number, number];
export type EntityModelCube = {
    /** min corner, pixels */
    origin: [number, number, number];
    size: [number, number, number];
    /** texture offset of the cube's uv box, pixels */
    uv: [number, number];
    /** grows the box on every side: one value or per axis */
    inflate?: number | [number, number, number];
    mirror?: boolean;
    /** visible faces when not all six, in the game's polygon order (down, up, west, north, east, south) */
    faces?: Array<'down' | 'up' | 'west' | 'north' | 'east' | 'south'>;
    /** when the cube divides its uvs by another size than the model's */
    textureSize?: [number, number];
};
export type EntityModelPart = {
    pose?: EntityPartPose;
    scale?: [number, number, number];
    cubes?: EntityModelCube[];
    children?: Record<string, EntityModelPart>;
};
export type EntityModelLayer = {
    textureSize: [number, number];
    root: EntityModelPart;
};
/** A part's pose after the renderer's setupAnim, when it differs from the initial pose. */
export type EntityPartRestPose = {
    /** the whole pose; scale is 1 when not given */
    pose?: EntityPartPose;
    scale?: [number, number, number];
    visible?: boolean;
    /** the part's own cubes are not drawn, its children are */
    skipDraw?: boolean;
};
type EntryBase = {
    /** column major 4x4, in blocks: entity space (the entity facing north, -z) from the model's space */
    transform: number[];
};
export type EntityModelEntry = EntryBase & {
    type: 'model';
    /** layer id, a key of the models */
    model: string;
    /** only this part of the layer, with the transform taken before its own pose ("/head") */
    part?: string;
    /** minecraft:entity/zombie/zombie -> textures/entity/zombie/zombie.png */
    texture?: string;
    /** the game's render type: entity_cutout, entity_translucent, eyes, ... */
    renderType: string;
    /** ARGB the texture is multiplied with, as a signed int; white when not given */
    tint?: number;
    /** by part path relative to the drawn part ("" is the part itself) */
    pose?: Record<string, EntityPartRestPose>;
    /** the model class that draws it (ZombieModel, BoatModel...): whose animation code (setupAnim) poses its parts */
    modelClass?: string;
};
export type EntityBlockEntry = EntryBase & {
    type: 'block';
    /** block state, minecraft:chest[facing=north,type=single,waterlogged=false] */
    block?: string;
};
export type EntityItemEntry = EntryBase & {
    type: 'item';
    /** item display context */
    context: string;
};
export type EntityCustomEntry = EntryBase & {
    type: 'custom';
    renderType: string;
    texture?: string;
};
export type EntityLookEntry = EntityModelEntry | EntityBlockEntry | EntityItemEntry | EntityCustomEntry;
export type EntityCondition = {
    /** synched data index (minecraft-data's metadataKeys index) */
    index: number;
    /** the synched data type (minecraft-data's entityMetadata type names) */
    type?: string;
    /** for structured values (villager_data): the field compared */
    field?: string;
    /** registry id, enum ordinal, number or boolean */
    value?: number | boolean | string;
    /** the enum constant name, for clients that read the value as a name (dye_color) */
    name?: string;
    /** compare value & mask */
    mask?: number;
    /** holds when the value differs from the default (long values: an anger end time) */
    notDefault?: boolean;
} | {
    /** equipment slot: mainhand, offhand, feet, legs, chest, head, body, saddle */
    slot: string;
    /** item name without namespace */
    item: string;
};
export type EntityState = {
    name: string;
    when: EntityCondition[];
    /** only on the first (default) state */
    look?: Record<string, EntityLookEntry>;
    /** on every other state: key -> null (remove), a whole entry (add or replace), or the changed properties (null removes one) */
    patch?: Record<string, Partial<Record<string, unknown>> | null>;
};
export type EntityDefinition = {
    /** the game's renderer class */
    renderer: string;
    /** for item-like entities (ThrownItemRenderer): the item they show by default */
    item?: string;
    /** synched data defaults for the indexes conditions read: the value when the client got none */
    defaults?: Record<string, unknown>;
    /** empty for entities that draw nothing (markers) */
    states: EntityState[];
    /** humanoid armor: per slot (head, chest, legs, feet) and item, what wearing it adds to the look */
    armor?: Record<string, Record<string, EntityArmorPiece>>;
    /** skulls and other items worn on the head (CustomHeadLayer), see {@link composeEntityHead} */
    head?: EntityHead;
    /** the synched data's names by index (1.14+: the accessor fields' names, as minecraft-data names metadata keys) */
    dataNames?: Record<string, string>;
    /** appearances that wear armor otherwise (a baby: its own armor model, or the adult one made young), with their conditions */
    armorVariants?: Array<{
        when: EntityCondition[];
        armor: Record<string, Record<string, EntityArmorPiece>>;
    }>;
};
export type EntityArmorPiece = {
    /** the entries drawn for the piece, as the game draws it worn alone (keys as in a look) */
    entries: Record<string, EntityLookEntry>;
    /** keys whose tint is the piece's dye color when it is dyed (leather) */
    dyeable?: string[];
    /** the piece trimmed (1.19.4+): drawn over it, see {@link composeEntityArmor} */
    trim?: EntityArmorTrim;
};
/** What a trimmed piece draws over itself: per trim entry, the piece's entry it copies with the trim's texture and render type. */
export type EntityArmorTrim = {
    /** the layer the trim's texture is named for: humanoid, humanoid_leggings */
    layer: string;
    /** what the materials' overrides are keyed by: the armor material before 1.20.5 (iron), its key (minecraft:iron) or equipment asset since */
    asset: string;
    /** trim entry key -> the key of the piece's entry it copies (all but texture, render type and tint) */
    entries: Record<string, string>;
};
/** How a version names trim textures: patterns and materials in network order (registry ids), layers, render types. */
export type TrimsData = {
    patterns: Array<{
        id: string;
        asset: string;
        decal?: boolean;
    }>;
    /** suffix: the material's texture suffix; overrides: by armor asset, another suffix (iron on iron armor: iron_darker) */
    materials: Array<{
        id: string;
        suffix: string;
        overrides?: Record<string, string>;
    }>;
    /** texture: <pattern namespace>:<prefix><pattern path><separator><suffix> */
    layers: Record<string, {
        prefix: string;
        separator: string;
    }>;
    renderTypes: {
        normal: string;
        decal: string;
    };
};
/** Where the head layer draws from: the parts of a model it moves along, in order, and the pose before the first. */
export type EntityHeadAnchor = {
    /** the layer the parts are of, a key of the models */
    model: string;
    /** part paths, each moved along as ModelPart.translateAndRotate does (position, then z, y, x rotation) */
    chain: string[];
    /** column major 4x4: entity space from the space the chain starts in */
    transform: number[];
};
/** What the head layer draws (CustomHeadLayer), relative to the anchor's frame: the pose after the chain's last part. */
export type EntityHeadLook = {
    anchor: EntityHeadAnchor;
    /** per skull item (minecraft-data's name; skull:<damage> before 1.13) its model entries, transforms relative to the frame */
    skulls: Record<string, Record<string, EntityModelEntry>>;
    /** any other item worn on the head (not head armor): drawn as the item, this pose before its display transform; before 1.9 only blocks */
    item?: {
        transform: number[];
        context: string;
        items: 'any' | 'blocks';
    };
    /** what wearing a skull or an item changes in the rest of the look */
    worn?: {
        skull?: NonNullable<EntityState['patch']>;
        item?: NonNullable<EntityState['patch']>;
    };
};
/** The head layer: its default look, and appearances that draw head items otherwise (a baby's anchor). */
export type EntityHead = EntityHeadLook & {
    variants?: Array<{
        when: EntityCondition[];
        hidden?: boolean;
    } & {
        [K in keyof EntityHeadLook]?: EntityHeadLook[K] | null;
    }>;
};
/** A painting variant: size in blocks, texture and the part of it the painting shows (all of it when not given). */
export type PaintingVariant = {
    /** registry id (minecraft:kebab), or the motive's title before 1.13 (Kebab) */
    id: string;
    width: number;
    height: number;
    texture: string;
    rect?: [number, number, number, number];
};
/** A quad PaintingRenderer draws: four vertices x, y, z (blocks, the painting facing north) and u, v within its texture's rectangle. */
export type PaintingQuad = {
    face: 'front' | 'back';
    vertices: Array<[number, number, number, number, number]>;
};
/** How a version draws paintings: its variants (network order) and the quads of each size. */
export type PaintingsData = {
    back: {
        texture: string;
        rect?: [number, number, number, number];
    };
    variants: PaintingVariant[];
    /** by size, "<width>x<height>" in blocks */
    templates: Record<string, PaintingQuad[]>;
};
export type EntityAnimationKeyframe = {
    t: number;
    v: [number, number, number];
    pre?: [number, number, number];
    i: 'linear' | 'catmullrom';
};
export type EntityAnimation = {
    length: number;
    looping?: boolean;
    bones: Record<string, Array<{
        target: 'position' | 'rotation' | 'scale';
        keyframes: EntityAnimationKeyframe[];
    }>>;
};
/** One version's export, as minecraft-model-generator writes it. */
export type EntityModelsExport = {
    version: string;
    format: number;
    models: Record<string, EntityModelLayer>;
    entities: Record<string, EntityDefinition>;
    animations: Record<string, EntityAnimation>;
    paintings?: PaintingsData;
    /** 1.19.4+ */
    trims?: TrimsData;
};
/** dist/entityModels.json: every exported version merged, mc-assets' versioned layout (a version key holds what was before it). */
export type EntityModelsData = {
    versions: string[];
    /** in dist/entityModels/<version>.json: the one export the file holds (as latest) */
    exportVersion?: string;
    /** per texture (entity/zombie/zombie) the other-textures versions holding what versions before them use */
    textureVersions?: Record<string, string[]>;
    models: Record<string, Record<string, EntityModelLayer>>;
    entities: Record<string, Record<string, EntityDefinition>>;
    animations: Record<string, Record<string, EntityAnimation>>;
    /** by version, under the key 'paintings' */
    paintings?: Record<string, Record<string, PaintingsData>>;
    /** by version, under the key 'trims' */
    trims?: Record<string, Record<string, TrimsData>>;
};
/** dist/entityModelsIndex.json: what a reader needs before loading an export. */
export type EntityModelsIndex = Pick<EntityModelsData, 'versions'> & {
    textureVersions: NonNullable<EntityModelsData['textureVersions']>;
    /** per entity name, the exports that have it (an entity behind a feature flag is missing from the release before) */
    entityExports: Record<string, string[]>;
};
/**
 * The export a world version reads (dist/entityModels/<export>.json): the newest export not newer than it, else the
 * oldest export.
 */
export declare const entityModelsExportFor: (versions: string[], version: string) => string | undefined;
export declare class EntityModelsStore {
    private models;
    private entities;
    private animations;
    private paintings;
    private trims;
    readonly versions: string[];
    constructor(data: EntityModelsData);
    /** How the version names trim textures (1.19.4+). */
    getTrims(version: string): TrimsData | undefined;
    /** How the version draws paintings. */
    getPaintings(version: string): PaintingsData | undefined;
    /** The oldest exported version is used for older versions. */
    getEntity(version: string, name: string): EntityDefinition | undefined;
    getModel(version: string, layer: string): EntityModelLayer | undefined;
    getAnimation(version: string, name: string): EntityAnimation | undefined;
}
/** What a condition reads from an entity: synched data by index (missing: the default) and equipment by slot. */
export type EntityLookInput = {
    metadata?: Record<number, unknown> | unknown[];
    /** equipment by slot name, item names without namespace */
    equipment?: Partial<Record<string, string | undefined>>;
    /** dye colors (RGB) of dyed equipment by slot (leather armor) */
    equipmentColors?: Partial<Record<string, number | undefined>>;
};
export declare const conditionHolds: (condition: EntityCondition, entity: EntityDefinition, input: EntityLookInput) => boolean;
/**
 * The entries an entity draws: the default look, with the patch of every state whose conditions all hold applied in
 * order of how many conditions it has (fewest first, file order among equals). Keys are kept so a renderer can tell
 * the entries apart (`<layer><part>#<n>`, `block#n`, `item#n`, `custom#n`).
 */
export declare const composeEntityLook: (entity: EntityDefinition, input?: EntityLookInput) => Array<{
    key: string;
    entry: EntityLookEntry;
}>;
export declare const applyEntityPatch: (look: Map<string, Record<string, unknown>>, patch: NonNullable<EntityState["patch"]>) => void;
/**
 * The other-textures folder a version reads a texture from: the oldest version key above it that holds a copy, else
 * latest (dist/other-textures/<folder>/<path>.png).
 */
export declare const entityTextureFolder: (data: Pick<EntityModelsData, "textureVersions">, texture: string, version: string) => string;
/** A trim as an item has it: pattern and material by network id (registry index) or id (minecraft:coast, coast). */
export type ArmorTrimInput = {
    pattern: number | string;
    material: number | string;
};
/**
 * The texture of a trim on a piece (its layer and asset, {@link EntityArmorTrim}): the pattern's asset under the layer's
 * prefix, then the material's suffix, or its override for the asset (iron trims on iron armor: iron_darker); undefined
 * when the trim names no exported pattern or material.
 */
export declare const trimTexture: (trims: TrimsData, trim: ArmorTrimInput, layer: string, asset: string) => string | undefined;
/**
 * The armor entries an entity draws for what it wears, keyed armor/<slot>/<key>: the pieces exported for it (a baby's
 * when its metadata says it is one), a dyed piece's dyeable entries tinted with its color (RGB), then a trimmed piece's
 * trim (armor/<slot>/trim/<key>), each a copy of the piece's entry it names with the trim's texture and render type.
 */
export declare const composeEntityArmor: (entity: EntityDefinition, equipment?: Partial<Record<string, string | undefined>>, colors?: Partial<Record<string, number | undefined>>, trims?: Partial<Record<string, ArmorTrimInput | undefined>>, trimsData?: TrimsData, input?: EntityLookInput) => Array<{
    key: string;
    entry: EntityLookEntry;
}>;
/** The head layer's look for the entity's metadata: the default, with every variant whose conditions hold (fewest first); undefined when hidden. */
export declare const entityHeadLook: (entity: EntityDefinition, input?: EntityLookInput) => EntityHeadLook | undefined;
/** What the head layer draws for an item worn on the head: a skull's model entries, or the item; nothing for head armor. */
export type EntityHeadDraw = {
    anchor: EntityHeadAnchor;
    /** a skull's model entries, their transforms relative to the anchor's frame */
    entries?: Array<{
        key: string;
        entry: EntityModelEntry;
    }>;
    /** any other item: drawn as the item with this pose (relative to the frame) before its display transform */
    item?: {
        transform: number[];
        context: string;
    };
    /** what wearing it changes in the rest of the look */
    worn?: NonNullable<EntityState['patch']>;
};
/**
 * What the head layer draws for the item an entity wears on its head (minecraft-data's name, the damage value before
 * 1.13 for skulls): a skull's entries, or the item as an item. Head armor the export draws as armor, and before 1.9 items
 * that are no blocks (isBlock), draw nothing here.
 */
export declare const composeEntityHead: (entity: EntityDefinition, input: EntityLookInput, item: {
    name: string;
    metadata?: number;
}, isBlock?: boolean) => EntityHeadDraw | undefined;
/** The painting variant of a network id (registry id, or index), or of an id or title. */
export declare const paintingVariant: (paintings: PaintingsData, variant: number | string | undefined) => PaintingVariant | undefined;
/** Equipment slot names in the order of the game's EquipmentSlot (the protocol's slot ids). */
export declare const ENTITY_EQUIPMENT_SLOTS: readonly ["mainhand", "offhand", "feet", "legs", "chest", "head", "body", "saddle"];
export {};
