import { VersionedStore } from './versionedStore';
import { AtlasCreatorOptions } from './atlasCreator';
type Texture = {
    u: number;
    v: number;
    tileIndex: number;
    su?: number;
    sv?: number;
};
/**
 * @unstable
 */
export interface ItemsAtlasesOutputJson {
    textures: Record<string, Texture>;
    width: number;
    height: number;
    tileSize: number;
    suSv: number;
}
interface ItemsAtlases {
    latest: ItemsAtlasesOutputJson;
    legacy?: ItemsAtlasesOutputJson;
}
export interface AtlasParserTransferrable {
}
type StoreType = Texture & {
    imageType: 'latest' | 'legacy';
    version: string;
};
type DataUrl = string;
export declare class AtlasParser {
    atlasJson: any;
    latestImage: string;
    legacyImage?: string | undefined;
    atlasStore: VersionedStore<StoreType>;
    atlasHasLegacyImage: boolean;
    static getTextureInfo(atlasStore: VersionedStore<StoreType>, itemsAtlases: ItemsAtlases, itemName: string, version?: string): {
        su: number;
        sv: number;
        u: number;
        v: number;
        tileIndex: number;
        imageType: "latest" | "legacy";
        version: string;
    } | undefined;
    constructor(atlasJson: any, latestImage: string, legacyImage?: string | undefined);
    get atlas(): ItemsAtlases;
    getTextureInfo(itemName: string, version?: string): {
        /** @deprecated */
        getLoadedImage: () => Promise<HTMLImageElement>;
        getLoadedAtlasImage: () => Promise<HTMLImageElement>;
        su: number;
        sv: number;
        u: number;
        v: number;
        tileIndex: number;
        imageType: "latest" | "legacy";
        version: string;
    } | undefined;
    makeNewAtlas(version: string, getCustomImage?: (itemName: string) => DataUrl | HTMLCanvasElement | HTMLImageElement | boolean | void, _unusedTileSize?: number, getTextureSortRankOrTopTextures?: string[] | ((key: string) => number), addTextures?: string[], options?: Pick<AtlasCreatorOptions, 'needHorizontalIndexes' | 'getCanvas'>): Promise<{
        canvas: HTMLCanvasElement;
        atlas: import("./atlasCreator").JsonAtlas;
        readonly newAtlasParser: AtlasParser;
        readonly image: string;
    }>;
    createDebugImage(writeNames?: boolean): Promise<string>;
}
export {};
