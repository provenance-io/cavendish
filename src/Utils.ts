import * as psTree from 'ps-tree';
import * as rimraf from 'rimraf';

export function delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => { 
        setTimeout(resolve, ms);
    });
}

export function killProcess(pid: number, killTree: boolean = true, signal: string = 'SIGTERM'): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        signal = signal || 'SIGKILL';
  
        if (killTree && process.platform !== 'win32') {
            psTree(pid, (err, children) => {
                [pid].concat(
                    children.map((p) => {
                        return Number.parseInt(p.PID);
                    })
                ).forEach(function(tpid) {
                    try {
                        process.kill(tpid, signal);
                    } catch (ex) {}
                });
                resolve();
            });
        } else {
            try {
                process.kill(pid, signal);
            } catch (ex) {}
            resolve();
        }
    });
}

export function rmDir(dir: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        rimraf(dir, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        })
    });
}