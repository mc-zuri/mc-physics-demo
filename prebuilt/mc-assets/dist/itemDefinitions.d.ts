import { ItemProperties, ResolvedItemModel } from './types';
import { ItemDefinitionsStore } from './stores';
import { ItemsRenderer } from './itemsRenderer';
export interface ItemSelector {
    version: string;
    name: string;
    properties: ItemProperties;
}
export declare const getItemDefinition: (store: ItemDefinitionsStore, selector: ItemSelector) => ResolvedItemModel | undefined;
export declare const getItemDefinitionModelResolved: (store: ItemDefinitionsStore, selector: ItemSelector, itemsRenderer: ItemsRenderer) => (ResolvedItemModel & {
    modelResolved: any;
}) | undefined;
