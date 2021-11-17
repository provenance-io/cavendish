import * as fs from 'fs';

import { CavendishConfig } from './Config';

interface LockFileData {
    pid?: number,
    initialized: boolean,
    config?: CavendishConfig,
}

const DEFAULT_LOCK_FILE_DATA: LockFileData = {
    initialized: false,
};

export class LockFile {

    constructor(fileName: string) {
        this.fileName = fileName;
        this.load();
    }

    public load() {
        if (fs.existsSync(this.fileName)) {
            this.data = JSON.parse(fs.readFileSync(this.fileName).toString('utf-8'));
        } else {
            this.save();
        }
    }

    public save() {
        fs.writeFileSync(this.fileName, JSON.stringify(this.data));
    }

    get initialized(): boolean {
        return this.data.initialized;
    }

    set initialized(initialized: boolean) {
        this.data.initialized = initialized;
        this.save();
    }

    get pid(): number {
        return this.data.pid;
    }

    set pid(pid: number) {
        this.data.pid = pid;
        this.save();
    }

    get config(): CavendishConfig {
        return this.data.config;
    }

    set config(config: CavendishConfig) {
        this.data.config = config;
        this.save();
    }

    private readonly fileName: string;
    private data: LockFileData = DEFAULT_LOCK_FILE_DATA;

}
