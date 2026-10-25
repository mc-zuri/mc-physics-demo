import { BlockModelsStore, BlockStatesStore } from './stores';
import { BlockElementPos, BlockModel, ResolvedBlockModel } from './types';
export interface QueriedBlock {
    stateId: number;
    name: string;
    properties: {
        [name: string]: string | boolean | number;
    };
}
export type BlockElement = [from: BlockElementPos, to: BlockElementPos];
export declare class AssetsParser {
    version: string;
    blockStatesStore: BlockStatesStore;
    blockModelsStore: BlockModelsStore;
    stateIdToElements: Record<string, BlockElement[] | 1>;
    constructor(version: string, blockStatesStore: BlockStatesStore, blockModelsStore: BlockModelsStore);
    getElementsCached(queriedBlock: QueriedBlock): 1 | BlockElement[];
    parseProperties(properties: string): Record<string, string | boolean>;
    getElements(queriedBlock: Omit<QueriedBlock, 'stateId'>, fallbackVariant?: boolean): 0 | 1 | BlockElement[];
    private resolvedModel;
    issues: string[];
    matchedModels: string[];
    matchedConditions: string[];
    private getModelsByBlock;
    private getModelData;
    getResolvedModelsByModel(model: string, debugQueryName?: string, clearModel?: boolean): {
        resolvedModel: ResolvedBlockModel;
    } | undefined;
    getResolvedModelsByModelData(modelData: BlockModel, debugQueryName?: string, clearModel?: boolean): {
        resolvedModel: ResolvedBlockModel;
    };
    getResolvedModelFirst(queriedBlock: Omit<QueriedBlock, 'stateId'>, fallbackVariant?: boolean): ResolvedBlockModel[] | undefined;
    getResolvedModelRandom(queriedBlock: Omit<QueriedBlock, 'stateId'>, fallbackVariant?: boolean): ResolvedBlockModel[] | undefined;
    getAllResolvedModels(queriedBlock: Omit<QueriedBlock, 'stateId'>, fallbackVariant?: boolean): ResolvedBlockModel[][] | undefined;
}
