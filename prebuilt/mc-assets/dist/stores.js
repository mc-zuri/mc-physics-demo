import { VersionedStore } from './versionedStore';
export const blockstatesStore = new VersionedStore();
export const modelsStore = new VersionedStore();
export const itemDefinitionsStore = new VersionedStore();
blockstatesStore.inclusive = false;
modelsStore.inclusive = false;
itemDefinitionsStore.inclusive = false;
export const getLoadedBlockstatesStore = (data) => {
    const blockstatesStore = new VersionedStore();
    blockstatesStore.inclusive = false;
    blockstatesStore.loadData(data.blockstates);
    return blockstatesStore;
};
export const getLoadedModelsStore = (data) => {
    const modelsStore = new VersionedStore();
    modelsStore.inclusive = false;
    modelsStore.loadData(data.models);
    return modelsStore;
};
export const getLoadedItemDefinitionsStore = (data) => {
    const itemDefinitionsStore = new VersionedStore();
    itemDefinitionsStore.inclusive = false;
    itemDefinitionsStore.loadData(data);
    return itemDefinitionsStore;
};
