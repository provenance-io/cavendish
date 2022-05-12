import { BigNumber } from "bignumber.js";
import * as bip39 from 'bip39';
import * as child_process from 'child_process';
import {
    createHash,
    randomBytes,
} from 'crypto';
const findProcess = require('find-process');
import * as fs from 'fs';
import * as _ from 'lodash';
import * as os from 'os';
import * as path from 'path';
import * as waitPort from 'wait-port';

import { 
    CavendishConfig,
    MarkerAccess,
    PortConfig,
} from './Config';
import {
    CAVENDISH_CLI_VERSION
} from './cli';
import { LockFile } from './LockFile';
import {
    delay,
    killProcess,
    rmDir,
} from './Utils';
import { 
    HDPathIndex,
    Wallet,
} from './Wallet';

const PROVENANCED_CLIENT_BINARY = 'provenanced';
const PIO_HOME_DIRECTORY = '.cavendish';

const HDPATH = "m/44'/1'/0'/0/0'";
const HASH_DENOM = 'nhash';

const VALIDATOR_HASH_RATIO = 0.2;
const VALIDATOR_DELEGATION_RATIO = 0.1;

const EXEC_SYNC_OPTIONS: child_process.ExecSyncOptions = { 
    stdio: 'ignore'
};

export const DEFAULT_CONFIG_FILE = 'cavendish.json';

export interface CavendishOptions {
    background?: boolean,
    force?: boolean,
    verbose?: boolean,
}

const DEFAULT_OPTIONS: CavendishOptions = {
    background: true,
    force: false,
    verbose: false
};

const ARCH_ALIASES = {
    "x64": "amd64"
};

export const DEFAULT_ACCOUNTS = 10;
export const DEFAULT_CHAIN_ID = 'chain-local';
export const DEFAULT_RPC_PORT = 26657;
export const DEFAULT_GRPC_PORT = 9090;
export const DEFAULT_HASH_SUPPLY = '100000000000000000000';
export const DEFAULT_ROOT_NAMES = [
    { "name": "pio", "restrict": true },
    { "name": "pb", "restrict": false },
    { "name": "io", "restrict": true },
    { "name": "provenance", "restrict": true },
];

export const DEFAULT_PORT_CONFIG: PortConfig = {
    rpc: DEFAULT_RPC_PORT,
    grpc: DEFAULT_GRPC_PORT
};

export const DEFAULT_CONFIG: CavendishConfig = {
    accounts: DEFAULT_ACCOUNTS,
    chainId: DEFAULT_CHAIN_ID,
    ports: DEFAULT_PORT_CONFIG,
    hashSupply: DEFAULT_HASH_SUPPLY,
    rootNames: DEFAULT_ROOT_NAMES,
    markers: []
};

export class Cavendish {

    constructor() {
        // get the provenanced binary and the PIO_HOME directory
        this.provenanced = Cavendish.getProvenancedBinary();
        this.pioHome = Cavendish.getPIOHomeDirectory();

        // load the lock file
        this.lockFile = new LockFile(path.join(this.pioHome, 'cavendish.lock'));
    }

    start(config: string | CavendishConfig = DEFAULT_CONFIG_FILE, options: CavendishOptions = DEFAULT_OPTIONS): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            var cavendishConfig: CavendishConfig;

            // merge options with default
            options = _.merge(DEFAULT_OPTIONS, options);

            // get the config
            if (typeof config === 'string') {
                try {
                    cavendishConfig = await Cavendish.loadConfigFile(config);
                } catch (err) {
                    return resolve(err);
                }
            } else {
                cavendishConfig = _.defaults(config, DEFAULT_CONFIG);
            }

            // generate a pseudo-random mnemonic if one is not provided
            var isMnemonicGenerated = false;
            if (cavendishConfig.mnemonic === undefined) {
                const entropy: Buffer = randomBytes(32);
                const entropyHash = createHash('sha256').update(entropy).digest();
                cavendishConfig.mnemonic = bip39.entropyToMnemonic(entropyHash);
                isMnemonicGenerated = true;
            }

            // ensure that it isn't already running
            const pid = await Cavendish.findProvenancePIDByHomeDir(this.pioHome);
            if (pid !== -1) {
                if (options.force) {
                    // stop the node
                    await this.stop();
                } else {
                    this.lockFile.pid = pid;

                    return reject(new Error('The provenance blockchain is already running'));
                }
            }

            // calculate the hash assigned to the validator at genesis
            const hashSupply = new BigNumber(cavendishConfig.hashSupply);
            const validatorHash = hashSupply.times(VALIDATOR_HASH_RATIO).integerValue(BigNumber.ROUND_DOWN);
            const validatorHashDelegation = validatorHash.times(VALIDATOR_DELEGATION_RATIO).integerValue(BigNumber.ROUND_DOWN);
            const accountsHashSupply = hashSupply.minus(validatorHash);
            const accountHash = accountsHashSupply.dividedBy(cavendishConfig.accounts).integerValue(BigNumber.ROUND_DOWN);

            if (this.lockFile.initialized && isMnemonicGenerated) {
                cavendishConfig.mnemonic = this.lockFile.config.mnemonic;
            }

            if (!this.lockFile.initialized || options.force) {
                // say hello
                if (options.verbose) {
                    Cavendish.sayHello();
                }

                // clear the old initialization if we need to force start
                if (options.force && fs.existsSync(this.pioHome)) {
                    await this.reset();
                    fs.mkdirSync(this.pioHome);
                }

                // initialize the config
                child_process.execSync([
                    this.provenanced,
                    '-t',
                    '--home', this.pioHome,
                    'init',
                    `--chain-id=${cavendishConfig.chainId}`,
                    'localnet'
                ].join(' '), EXEC_SYNC_OPTIONS);

                // add the validator
                child_process.execSync([
                    this.provenanced,
                    '-t',
                    '--home', this.pioHome,
                    'keys',
                    'add',
                    'validator',
                    '--keyring-backend', 'test'
                ].join(' '), EXEC_SYNC_OPTIONS);
                child_process.execSync([
                    this.provenanced,
                    '-t',
                    '--home', this.pioHome,
                    'add-genesis-account',
                    'validator',
                    `${validatorHash.toFixed()}nhash`,
                    '--keyring-backend', 'test'
                ].join(' '), EXEC_SYNC_OPTIONS);

                // generate the accounts
                for(var key = 0; key < cavendishConfig.accounts; key++) {
                    this.addGenesisAccountFromMnemonic(`account${key}`, cavendishConfig.mnemonic, 0, key, accountHash.toFixed());
                }

                // create the root names
                cavendishConfig.rootNames.forEach((rootName) => {
                    this.addGenesisRootName('validator', rootName.name, rootName.restrict);
                });

                // create the hash marker
                this.addGenesisMarker(HASH_DENOM, hashSupply, 'validator', [
                    MarkerAccess.ADMIN,
                    MarkerAccess.BURN,
                    MarkerAccess.DEPOSIT,
                    MarkerAccess.MINT,
                    MarkerAccess.WITHDRAW
                ]);
                child_process.execSync([
                    this.provenanced,
                    '-t',
                    '--home', this.pioHome,
                    'gentx',
                    'validator',
                    `${validatorHashDelegation.toFixed()}nhash`,
                    '--keyring-backend', 'test',
                    `--chain-id=${cavendishConfig.chainId}`
                ].join(' '), EXEC_SYNC_OPTIONS);

                // create markers from config
                cavendishConfig.markers.forEach((marker) => {
                    this.addGenesisMarker(marker.denom, new BigNumber(marker.totalSupply), marker.manager, marker.access);
                });

                // collect the genesis transactions
                child_process.execSync([
                    this.provenanced,
                    '-t',
                    '--home', this.pioHome,
                    'collect-gentxs'
                ].join(' '), EXEC_SYNC_OPTIONS);

                // set configuration
                this.setConfig('rpc.laddr', `tcp://localhost:${cavendishConfig.ports.rpc}`);
                this.setConfig('p2p.laddr', 'tcp://localhost:26656');
                this.setConfig('grpc.address', `localhost:${cavendishConfig.ports.grpc}`);
                this.setConfig('grpc-web.enable', 'false');
                this.setConfig('api.enable', 'true');
                this.setConfig('api.address', 'tcp://localhost:1317');
                this.setConfig('api.swagger', 'true');

                // we're now initialized
                this.lockFile.initialized = true;
                this.lockFile.config = cavendishConfig;
            } else {
                if (!_.isEqual(cavendishConfig, this.lockFile.config)) {
                    return reject(new Error(`Configuration does not match the already initialized blockchain data.\nReset the blockchain data first.`));
                }

                // say hello
                if (options.verbose) {
                    Cavendish.sayHello();
                }
            }

            // get the wallet for the accounts from the mnemonic
            const accounts = Wallet.fromMnemonic(cavendishConfig.mnemonic, false);

            // output the available accounts and base HD path
            if (options.verbose) {
                console.log('Available Accounts');
                console.log('==================');
                const numSpaces = (Math.floor(cavendishConfig.accounts / 10) + 4);
                for(var idx = 0; idx < cavendishConfig.accounts; idx++) {
                    const key = accounts.getKey(0, idx);
                    const accountIndex = `(${idx})`.toString().padEnd(numSpaces);
                    console.log(`${accountIndex}${key.address} (${accountHash.toFixed()} nhash)`);
                }
                console.log('');

                // generate the base HD path for display
                let hdPathParts = HDPATH.split('/');
                hdPathParts[HDPathIndex.ADDRESS_INDEX] = "{account_index}'";
                const baseHdPath = hdPathParts.join('/');
                
                console.log('HD Wallet');
                console.log('==================');
                console.log(`Mnemonic:      ${cavendishConfig.mnemonic}`);
                console.log(`Base HD Path:  ${baseHdPath}`);
                console.log('');
            }

            // start the node and save PID to file
            var startArgs = [
                this.provenanced,
                '-t',
                '--home', this.pioHome,
                'start'
            ];
            var startOpts: child_process.ExecSyncOptions = { stdio: 'inherit' };
            if (options.background && (options.background === true || options.background === 'true')) {
                startArgs.unshift('nohup');
                startArgs.push('&');
                startOpts = { stdio: 'ignore' };
            }
            child_process.execSync(startArgs.join(' '), startOpts);

            if (options.background && (options.background === true || options.background === 'true')) {
                // wait for the process to settle
                try {
                    const grpcPortOpened = await waitPort({
                        host: 'localhost',
                        port: cavendishConfig.ports.grpc,
                        timeout: 10000,
                        output: (options.verbose ? 'dots' : 'silent')
                    });

                    if (grpcPortOpened) {
                        const pid = await Cavendish.findProvenancePIDByHomeDir(this.pioHome);
                        if (pid === -1) {
                            return reject(new Error('Failed to start the provenance blockchain'));
                        } else {
                            // save the PID to the lock file
                            this.lockFile.pid = pid;
                        }
                    } else {
                        return reject(new Error('Failed to start the provenance blockchain'));
                    }
                } catch(err) {
                    return reject(new Error('Failed to start the provenance blockchain'));
                }
            }

            return resolve();
        });
    }

    stop(): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            const pid = await Cavendish.findProvenancePIDByHomeDir(this.pioHome);
            if (pid === -1) {
                // clear the PID from the lock file
                this.lockFile.pid = undefined;

                return reject(new Error('The provenance blockchain is not currently running'));
            } else {
                // kill the procenance node
                await killProcess(pid);

                // wait for the provenance node to stop (10s timeout)
                await Cavendish.waitForPid(pid, 10000);

                // clear the PID from the lock file
                this.lockFile.pid = undefined;

                return resolve();
            }
        });
    }

    reset(): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {

            // ensure that the node is not running
            const pid = await Cavendish.findProvenancePIDByHomeDir(this.pioHome);
            if (pid !== -1) {
                return reject(new Error('Cannot reset the blockchain data while provenance blockchain is running'));
            }

            // delete the blockchain data
            if (fs.existsSync(this.pioHome)) {
                await rmDir(this.pioHome);
            }

            return resolve();

        });
    }

    stopAndReset(): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            try {
                await this.stop();
                await this.reset();
            } catch (err) {
                return reject(err);
            };
            return resolve();
        });
    }

    public static loadConfigFile(configFile: string): Promise<CavendishConfig> {
        return new Promise<CavendishConfig>((resolve, reject) => {
            if (fs.existsSync(configFile)) {
                return resolve(JSON.parse(fs.readFileSync(configFile).toString('utf-8')));
            } else {
                return reject(new Error(`Unable to open config file '${configFile}'`));
            }
        });
    }

    public static getArch(): string {
        const arch = os.arch();
        if (arch in ARCH_ALIASES) {
            return ARCH_ALIASES[arch];
        } else {
            return arch;
        }
    }

    public static getProvenancedBinary(): string {
        return path.join(
            __dirname, 
            '..', 
            'bin', 
            Cavendish.getArch(), 
            os.platform(),
            PROVENANCED_CLIENT_BINARY
        );
    }

    private static getPIOHomeDirectory(): string {
        const pioHomeDir = path.join(process.cwd(), PIO_HOME_DIRECTORY);
        try {
            const dirStat = fs.statSync(pioHomeDir);
        } catch (err) {
            fs.mkdirSync(pioHomeDir);
        }
        return pioHomeDir;
    }

    private static findProvenancePIDByHomeDir(home: string): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            findProcess('name', PROVENANCED_CLIENT_BINARY, true).then((processes) => {
                var pid: number = -1;
                processes.forEach((proc) => {
                    var procPioHome = '';

                    const args = proc.cmd.split(' ');
                    args.forEach((arg, idx) => {
                        if (arg.toLowerCase() === '--home') {
                            procPioHome = args[idx + 1];
                        }
                    });
                    
                    if (procPioHome === home) {
                        pid = proc.pid;
                    }
                });
                return resolve(pid);
            }).catch((err) => {
                return reject(err);
            })
        });
    }

    private static waitForPid(pid: number, timeoutMs?: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            var timeout = undefined;
            if (timeoutMs !== undefined) {
                timeout = setTimeout(() => {
                    clearInterval(interval);
                    return reject(new Error(`Timeout waiting for process '${pid}' to terminate`));
                }, timeoutMs);
            }

            const interval = setInterval(async () => {
                try {
                    const processes = await findProcess('pid', pid, true);
                    if (processes.length === 0) {
                        if (timeout !== undefined) {
                            clearTimeout(timeout);
                        }
                        clearInterval(interval);
                        return resolve();
                    }
                } catch(err) {
                    return reject(err);
                }
            }, 250);
        });
    }

    protected addGenesisAccountFromMnemonic(name: string, mnemonic: string, keyring: number, key: number, hashBalance: string) {
        if (!Number.isInteger(keyring)) {
            throw new Error(`Keyring ${keyring} is not an integer`);
        }
        if (!Number.isInteger(key)) {
            throw new Error(`Key ${key} is not an integer`);
        }

        let hdpath_parts = HDPATH.split('/');
        hdpath_parts[HDPathIndex.CHANGE] = keyring.toString();
        hdpath_parts[HDPathIndex.ADDRESS_INDEX] = key.toString() + "'";
        let hdpath = hdpath_parts.join('/');

        child_process.execSync([
            'echo', `"${mnemonic}"`, '|',
            this.provenanced,
            '-t',
            '--home', this.pioHome,
            'keys',
            'add',
            name,
            '--recover',
            '--keyring-backend', 'test',
            '--hd-path', `"${hdpath}"`
        ].join(' '), EXEC_SYNC_OPTIONS);
        child_process.execSync([
            this.provenanced,
            '-t',
            '--home', this.pioHome,
            'add-genesis-account',
            name,
            `${hashBalance}${HASH_DENOM}`,
            '--keyring-backend',
            'test'
        ].join(' '), EXEC_SYNC_OPTIONS);
    }

    protected addGenesisRootName(key: string, name: string, restricted: boolean = false) {
        child_process.execSync([
            this.provenanced,
            '-t',
            '--home', this.pioHome,
            'add-genesis-root-name',
            key,
            name,
            (restricted ? '--restrict' : '--restrict=false'),
            '--keyring-backend', 'test'
        ].join(' '), EXEC_SYNC_OPTIONS);
    }

    protected addGenesisMarker(denom: string, supply: BigNumber, manager: string, access: MarkerAccess[]) {
        child_process.execSync([
            this.provenanced,
            '-t',
            '--home', this.pioHome,
            'add-genesis-marker',
            `${supply.toFixed()}${denom}`,
            '--manager', manager,
            '--access', access.join(','),
            '--activate',
            '--keyring-backend', 'test'
        ].join(' '), EXEC_SYNC_OPTIONS);
    }

    protected setConfig(name: string, value: string) {
        child_process.execSync([
            this.provenanced,
            '-t',
            '--home', this.pioHome,
            'config',
            'set',
            name, value
        ].join(' '), EXEC_SYNC_OPTIONS);
    }

    private static sayHello() {
        console.log('');
        console.log(`Cavendish ${CAVENDISH_CLI_VERSION}`);
        console.log('');
    }

    private readonly provenanced: string;
    private readonly pioHome: string;

    private lockFile: LockFile;

}
