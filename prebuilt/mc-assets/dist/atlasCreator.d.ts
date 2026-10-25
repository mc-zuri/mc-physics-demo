export declare const MAX_CANVAS_SIZE = 16384;
export declare const getAtlasSize: (numberOfTiles: number, tileSize: number) => {
    width: number;
    height: number;
};
export type JsonAtlas = {
    suSv: number;
    tileSize: number;
    width: number;
    height: number;
    textures: {
        [file: string]: {
            u: number;
            v: number;
        };
    };
};
export type AtlasCreatorOptions = {
    input: string[];
    getLoadedImage: (name: any) => {
        contents?: string;
        image?: HTMLImageElement | HTMLCanvasElement;
        tileWidthMult?: number;
        useOriginalSize?: boolean;
        renderWidth?: number;
        renderHeight?: number;
        renderSourceStartX?: number;
        renderSourceStartY?: number;
        renderSourceWidth?: number;
        renderSourceHeight?: number;
    };
    needHorizontalIndexes?: boolean;
    tileSize?: number;
    getCanvas?: (imgSize: number) => HTMLCanvasElement;
};
export declare const makeTextureAtlas: ({ input, getLoadedImage, tileSize, getCanvas, needHorizontalIndexes, }: AtlasCreatorOptions) => {
    json: JsonAtlas;
    canvas: HTMLCanvasElement;
};
