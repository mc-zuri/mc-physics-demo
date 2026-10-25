export declare class VersionedStore<T = string> {
    strictVersioned: boolean;
    data: {
        latest: Record<string, T>;
        [version: string]: Record<string, T>;
    };
    previousVersion: string;
    currentVersion: string;
    inclusive: boolean;
    constructor(strictVersioned?: boolean);
    get versionsSorted(): string[];
    /** The order is important: from newest to oldest */
    push(version: string, key: string, data: T): void;
    get(version: string, key: string, inclusive?: boolean): T | undefined;
    semverToNumber(version: string): number;
    loadData(data: typeof this.data): void;
}
