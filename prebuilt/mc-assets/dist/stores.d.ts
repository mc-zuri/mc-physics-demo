import { BlockModel, BlockStates, ItemDefinition, ItemModel } from './types';
import { VersionedStore } from './versionedStore';
export type BlockStatesStore = VersionedStore<BlockStates>;
export type BlockModelsStore = VersionedStore<BlockModel & ItemModel>;
export type ItemDefinitionsStore = VersionedStore<ItemDefinition>;
export declare const blockstatesStore: VersionedStore<BlockStates>;
export declare const modelsStore: VersionedStore<BlockModel & {
    overrides?: Array<{
        predicate: {
            [name: string]: string | number;
        };
        model: string;
    }>;
    display?: {
        thirdperson?: {
            rotation?: [number, number, number];
            translation?: [number, number, number];
            scale?: [number, number, number];
        };
        firstperson?: {
            rotation?: [number, number, number];
            translation?: [number, number, number];
            scale?: [number, number, number];
        };
        gui?: {
            rotation?: [number, number, number];
            translation?: [number, number, number];
            scale?: [number, number, number];
        };
        head?: {
            rotation?: [number, number, number];
            translation?: [number, number, number];
            scale?: [number, number, number];
        };
        ground?: {
            rotation?: [number, number, number];
            translation?: [number, number, number];
            scale?: [number, number, number];
        };
        fixed?: {
            rotation?: [number, number, number];
            translation?: [number, number, number];
            scale?: [number, number, number];
        };
    };
}>;
export declare const itemDefinitionsStore: VersionedStore<{
    model?: any;
    disable_hand_animation?: boolean | undefined;
}>;
export declare const getLoadedBlockstatesStore: (data: {
    blockstates: any;
}) => VersionedStore<BlockStates>;
export declare const getLoadedModelsStore: (data: {
    models: any;
}) => VersionedStore<BlockModel & {
    overrides?: Array<{
        predicate: {
            [name: string]: string | number;
        };
        model: string;
    }>;
    display?: {
        thirdperson?: {
            rotation?: [number, number, number];
            translation?: [number, number, number];
            scale?: [number, number, number];
        };
        firstperson?: {
            rotation?: [number, number, number];
            translation?: [number, number, number];
            scale?: [number, number, number];
        };
        gui?: {
            rotation?: [number, number, number];
            translation?: [number, number, number];
            scale?: [number, number, number];
        };
        head?: {
            rotation?: [number, number, number];
            translation?: [number, number, number];
            scale?: [number, number, number];
        };
        ground?: {
            rotation?: [number, number, number];
            translation?: [number, number, number];
            scale?: [number, number, number];
        };
        fixed?: {
            rotation?: [number, number, number];
            translation?: [number, number, number];
            scale?: [number, number, number];
        };
    };
}>;
export declare const getLoadedItemDefinitionsStore: (data: any) => VersionedStore<{
    model?: any;
    disable_hand_animation?: boolean | undefined;
}>;
