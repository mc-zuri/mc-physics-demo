import { QueriedBlock } from './assetsParser';
import { BlockModel } from './types';
export default function worldBlockProvider(blockstatesModels: any, blocksAtlas: any, version: string): {
    getAllResolvedModels0_1(block: Omit<QueriedBlock, "stateId">, fallbackVariant?: boolean, possibleIssues?: string[], matchedModels?: string[], matchedConditions?: string[], partialElementsProcessing?: boolean): ({
        elements: {
            faces: {
                [k: string]: {
                    texture: {
                        u: number;
                        v: number;
                        su: number;
                        sv: number;
                        tileIndex: number;
                        debugName: string;
                    };
                    uv?: number[];
                    cullface?: string;
                    rotation?: number;
                    tintindex?: number;
                };
            };
            from: import("./types").BlockElementPos;
            to: import("./types").BlockElementPos;
            rotation?: {
                origin: [number, number, number];
                rescale?: boolean;
            } & ({
                axis: string;
                angle: number;
            } | {
                x?: number;
                y?: number;
                z?: number;
            });
        }[];
    } & Omit<import("./types").ResolvedBlockModel, "textures" | "elements">)[][];
    transformModel: <T extends BlockModel | import("./types").ResolvedBlockModel>(model: T, block: Omit<QueriedBlock, "stateId">, elementsProcessingIssues?: string[]) => {
        elements: {
            faces: {
                [k: string]: {
                    texture: {
                        u: number;
                        v: number;
                        su: number;
                        sv: number;
                        tileIndex: number;
                        debugName: string;
                    };
                    uv?: number[];
                    cullface?: string;
                    rotation?: number;
                    tintindex?: number;
                };
            };
            from: import("./types").BlockElementPos;
            to: import("./types").BlockElementPos;
            rotation?: {
                origin: [number, number, number];
                rescale?: boolean;
            } & ({
                axis: string;
                angle: number;
            } | {
                x?: number;
                y?: number;
                z?: number;
            });
        }[];
    } & Omit<T, "textures" | "elements">;
    getTextureInfo: (textureName: string) => {
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
};
export type WorldBlockProvider = ReturnType<typeof worldBlockProvider>;
