export class VersionedStore {
    strictVersioned;
    data = {
        latest: {}
    };
    previousVersion = '';
    currentVersion = '';
    inclusive = true;
    constructor(strictVersioned = false) {
        this.strictVersioned = strictVersioned;
        if (strictVersioned) {
            this.data = {};
        }
    }
    get versionsSorted() {
        const versions = Object.keys(this.data).filter(x => x !== 'latest').sort((a, b) => this.semverToNumber(a) - this.semverToNumber(b));
        if (!this.strictVersioned)
            versions.push('latest');
        return versions;
    }
    /** The order is important: from newest to oldest */
    push(version, key, data) {
        this.currentVersion ||= version;
        if (this.currentVersion !== version) {
            if (this.strictVersioned) {
                this.previousVersion = this.currentVersion;
            }
            else {
                this.previousVersion = this.previousVersion ? this.currentVersion : 'latest';
            }
            this.currentVersion = version;
        }
        if (this.data[this.previousVersion]?.[key] === data)
            return;
        if (this.strictVersioned) {
            this.data[version] ??= {};
            this.data[version][key] = data;
        }
        else {
            if (this.data.latest[key]) {
                this.data[version] ??= {};
                this.data[version][key] = data;
            }
            else {
                this.data.latest[key] = data;
            }
        }
    }
    get(version, key, inclusive = this.inclusive) {
        const verNum = this.semverToNumber(version);
        let firstNextVersion;
        for (const ver of this.versionsSorted) {
            if ((inclusive ? verNum <= this.semverToNumber(ver) : verNum < this.semverToNumber(ver)) && this.data[ver]?.[key]) {
                firstNextVersion = ver;
                break;
            }
        }
        let result;
        if (this.strictVersioned) {
            result = this.data[firstNextVersion]?.[key];
        }
        else {
            if (this.data[firstNextVersion]?.[key])
                result = this.data[firstNextVersion][key];
            else if (this.data.latest[key])
                result = this.data.latest[key];
        }
        return result && typeof result === 'object' ? structuredClone(result) : result;
    }
    semverToNumber(version) {
        const [x, y = '0', z = '0'] = version.split('.');
        return +`${x.padStart(2, '0')}${y.padStart(2, '0')}${z.padStart(2, '0')}`;
    }
    loadData(data) {
        this.data = data;
    }
}
