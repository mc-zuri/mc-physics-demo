import { z } from 'zod';
type ModelBasic = {
    model: string;
    x?: number;
    z?: number;
    y?: number;
    uvlock?: boolean;
    /** only for array models */
    weight?: number;
};
export type BlockApplyModel = ModelBasic | (ModelBasic & {
    weight: any;
})[];
type CurrentStateValue = string | 'true' | 'false' | number;
export type BlockStateConditions = {
    [name: string]: CurrentStateValue;
};
type CurrentStateWhen = string;
export type BlockStates = {
    variants?: {
        [name: CurrentStateWhen | ""]: BlockApplyModel;
    };
    multipart?: {
        when?: {
            [name: string]: string | number;
        } & {
            OR?: BlockStateConditions[];
            AND?: BlockStateConditions[];
        };
        apply: BlockApplyModel;
    }[];
};
export type BlockElementPos = [number, number, number];
export type BlockModel = {
    parent?: string;
    textures?: {
        [name: string]: string;
    };
    elements?: {
        from: BlockElementPos;
        to: BlockElementPos;
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
        faces: {
            [name: string]: {
                texture: string;
                uv?: number[];
                cullface?: string;
                rotation?: number;
                tintindex?: number;
            };
        };
    }[];
    ambientocclusion?: boolean;
    ao?: boolean;
};
export type ResolvedBlockModel = Pick<BlockModel, 'textures' | 'elements' | 'ao'> & {
    modelName: string;
    x?: number;
    y?: number;
    z?: number;
    uvlock?: boolean;
    weight?: number;
};
type DisplayPresentation = {
    rotation?: [number, number, number];
    translation?: [number, number, number];
    scale?: [number, number, number];
};
export type ItemModel = BlockModel & {
    overrides?: Array<{
        predicate: {
            [name: CurrentStateWhen]: CurrentStateValue;
        };
        model: string;
    }>;
    display?: {
        thirdperson?: DisplayPresentation;
        firstperson?: DisplayPresentation;
        gui?: DisplayPresentation;
        head?: DisplayPresentation;
        ground?: DisplayPresentation;
        fixed?: DisplayPresentation;
    };
};
export declare const DisplayContext: z.ZodEnum<["gui", "ground", "fixed", "head", "firstperson", "thirdperson"]>;
export type DisplayContextType = z.infer<typeof DisplayContext>;
export declare const ItemPropertyTypes: z.ZodObject<{
    'minecraft:using_item': z.ZodBoolean;
    'minecraft:use_duration': z.ZodNumber;
    'minecraft:display_context': z.ZodEnum<["gui", "ground", "fixed", "head", "firstperson", "thirdperson"]>;
    'minecraft:broken': z.ZodBoolean;
    'minecraft:damage': z.ZodNumber;
    'minecraft:cooldown': z.ZodNumber;
    'minecraft:custom_model_data': z.ZodNumber;
    'minecraft:bundle/has_selected_item': z.ZodBoolean;
    'minecraft:trim_material': z.ZodString;
    'minecraft:use_cycle': z.ZodNumber;
    'minecraft:block_state': z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
    'minecraft:date': z.ZodOptional<z.ZodDate>;
    'minecraft:local_time': z.ZodOptional<z.ZodDate>;
    'minecraft:time': z.ZodOptional<z.ZodNumber>;
    'minecraft:context_dimension': z.ZodOptional<z.ZodString>;
    'minecraft:compass': z.ZodOptional<z.ZodNumber>;
    'minecraft:has_component': z.ZodOptional<z.ZodBoolean>;
    use_duration_ms: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    'minecraft:using_item': boolean;
    'minecraft:use_duration': number;
    'minecraft:display_context': "head" | "gui" | "ground" | "fixed" | "firstperson" | "thirdperson";
    'minecraft:broken': boolean;
    'minecraft:damage': number;
    'minecraft:cooldown': number;
    'minecraft:custom_model_data': number;
    'minecraft:bundle/has_selected_item': boolean;
    'minecraft:trim_material': string;
    'minecraft:use_cycle': number;
    'minecraft:block_state': Record<string, string | number | boolean>;
    'minecraft:date'?: Date | undefined;
    'minecraft:local_time'?: Date | undefined;
    'minecraft:time'?: number | undefined;
    'minecraft:context_dimension'?: string | undefined;
    'minecraft:compass'?: number | undefined;
    'minecraft:has_component'?: boolean | undefined;
    use_duration_ms?: number | undefined;
}, {
    'minecraft:using_item': boolean;
    'minecraft:use_duration': number;
    'minecraft:display_context': "head" | "gui" | "ground" | "fixed" | "firstperson" | "thirdperson";
    'minecraft:broken': boolean;
    'minecraft:damage': number;
    'minecraft:cooldown': number;
    'minecraft:custom_model_data': number;
    'minecraft:bundle/has_selected_item': boolean;
    'minecraft:trim_material': string;
    'minecraft:use_cycle': number;
    'minecraft:block_state': Record<string, string | number | boolean>;
    'minecraft:date'?: Date | undefined;
    'minecraft:local_time'?: Date | undefined;
    'minecraft:time'?: number | undefined;
    'minecraft:context_dimension'?: string | undefined;
    'minecraft:compass'?: number | undefined;
    'minecraft:has_component'?: boolean | undefined;
    use_duration_ms?: number | undefined;
}>;
export type ItemProperties = Partial<z.infer<typeof ItemPropertyTypes>>;
export declare const ItemDefinitionSchema: z.ZodObject<{
    model: any;
    disable_hand_animation: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    model?: any;
    disable_hand_animation?: boolean | undefined;
}, {
    model?: any;
    disable_hand_animation?: boolean | undefined;
}>;
export type ItemDefinition = z.infer<typeof ItemDefinitionSchema>;
export interface ResolvedItemModel {
    model: string;
    tints?: Array<{
        type: 'minecraft:constant';
        value: number;
    }>;
    special?: Record<string, any>;
    watchProperties?: Array<{
        property: keyof ItemProperties;
        type: 'range' | 'condition' | 'select';
        currentValue?: any;
        source?: string;
        target?: string;
    }>;
}
export {};
