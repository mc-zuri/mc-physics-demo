import { AtlasParser } from './atlasParser';
import { AssetsParser } from './assetsParser';
import { BlockModelsStore, BlockStatesStore } from './stores';
import { BlockModel } from './types';
export declare class ItemsRenderer {
    version: string;
    itemsAtlasParser: AtlasParser;
    blocksAtlasParser?: AtlasParser | undefined;
    blockStatesStore: BlockStatesStore;
    modelsStore: BlockModelsStore;
    assetsParser: AssetsParser;
    constructor(version: string, blockstatesModels: any, itemsAtlasParser: AtlasParser, blocksAtlasParser?: AtlasParser | undefined);
    resolveTexture(texture: string): {
        slice: [number, number, number, number];
        type: string;
        /** @deprecated */
        path: string;
    } | undefined;
    resolveBlockModel(model: any, blockName: string): {
        resolvedModel: import("./types").ResolvedBlockModel;
        readonly top: string;
        readonly left: string;
        readonly right: string;
    } | undefined;
    tryGetFullBlock(model: any, blockName: string): {
        top: {
            slice: [number, number, number, number];
            type: string;
            /** @deprecated */
            path: string;
        };
        left: {
            slice: [number, number, number, number];
            type: string;
            /** @deprecated */
            path: string;
        };
        right: {
            slice: [number, number, number, number];
            type: string;
            /** @deprecated */
            path: string;
        };
        resolvedModel: BlockModel;
    } | undefined;
    getItemTexture(itemNameOrModel: string, _properties?: Record<string, string | boolean>, exactItemResolve?: boolean, onlyResolveBlockModel?: boolean): {
        slice: [number, number, number, number];
        type: string;
        /** @deprecated */
        path: string;
    } | {
        resolvedModel: import("./types").ResolvedBlockModel;
        readonly top: string;
        readonly left: string;
        readonly right: string;
    } | {
        top: {
            slice: [number, number, number, number];
            type: string;
            /** @deprecated */
            path: string;
        };
        left: {
            slice: [number, number, number, number];
            type: string;
            /** @deprecated */
            path: string;
        };
        right: {
            slice: [number, number, number, number];
            type: string;
            /** @deprecated */
            path: string;
        };
        resolvedModel: BlockModel;
    } | undefined;
}
