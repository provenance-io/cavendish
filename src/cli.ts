import * as bip39 from 'bip39';
import * as child_process from 'child_process';
import { 
    createHash, 
    randomBytes, 
} from 'crypto';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as os from 'os';
import * as path from 'path';

import { BigNumber } from "bignumber.js";
import { 
    Command, 
    OptionValues, 
} from 'commander';
const findProcess = require('find-process');

import { 
    CavendishConfig, 
    MarkerAccess, 
    PortConfig,
    RootName, 
} from './Config';
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

const EXEC_SYNC_OPTIONS: child_process.ExecSyncOptions = { 
    stdio: 'ignore'
};

enum CavendishCommand {
    START,
    STOP,
    RESET
}

const CAVENDISH_CLI_VERSION = '1.7.5';

const PROVENANCED_CLIENT_BINARY = 'provenanced';
const PIO_HOME_DIRECTORY = '.cavendish';

const HDPATH = "m/44'/1'/0'/0/0'";
const HASH_DENOM = 'nhash';
const NHASH_PER_HASH = 1000000000;

const VALIDATOR_HASH_RATIO = 0.2;
const VALIDATOR_DELEGATION_RATIO = 0.1;

const DEFAULT_CONFIG_FILE = 'cavendish.json';
const DEFAULT_ACCOUNTS = 10;
const DEFAULT_CHAIN_ID = 'chain-local';
const DEFAULT_RPC_PORT = 26657;
const DEFAULT_GRPC_PORT = 9090;
const DEFAULT_HASH_SUPPLY = '100000000000000000000';
const DEFAULT_ROOT_NAMES = [
    { "name": "pio", "restrict": true },
    { "name": "pb", "restrict": false },
    { "name": "io", "restrict": true },
    { "name": "provenance", "restrict": true },
];

const DEFAULT_PORT_CONFIG: PortConfig = {
    rpc: DEFAULT_RPC_PORT,
    grpc: DEFAULT_GRPC_PORT
};

const DEFAULT_CONFIG: CavendishConfig = {
    accounts: DEFAULT_ACCOUNTS,
    chainId: DEFAULT_CHAIN_ID,
    ports: DEFAULT_PORT_CONFIG,
    hashSupply: DEFAULT_HASH_SUPPLY,
    rootNames: DEFAULT_ROOT_NAMES,
    markers: []
};

export class Cavendish {

    constructor() {
        this.startCommand = new Command('start')
            .description('Start a provenance blockchain node')
            .option('-c, --config <file>', 'the cavendish config file', DEFAULT_CONFIG_FILE)
            .option('-f, --force', 'force resets the blockchain')
            .option('-b, --background [true|false]', 'run the blockchain in the background', true)
            .option('-m, --mnemonic <phrase>', 'bip39 mnemonic phrase for generating seed')
            .option('-a, --accounts <num>', 'total accounts to generate')
            .option('-r, --restrictedRootNames <name1,name2,...>', 'list of restricted root names to create')
            .option('-u, --unrestrictedRootNames <name1,name2,...>', 'list of unrestricted root names to create')
            .option('-s, --hashSupply <supply>', 'the total supply of nhash tokens')
            .option('-i, --chainId <id>', 'the provenance chain id')
            .option('-p, --rpcPort <port>', 'the port to use for RPC connections to the node')
            .option('-g, --grpcPort <port>', 'the port to use for gRPC connections to the node')
            .action(() => {
                this.command = CavendishCommand.START;
            });

        this.stopCommand = new Command('stop')
            .description('Stops a running provenance blockchain node')
            .action(() => {
                this.command = CavendishCommand.STOP;
            });

        this.resetCommand = new Command('reset')
            .description('Resets the provenance blockchain')
            .action(() => {
                this.command = CavendishCommand.RESET;
            });

        this.cli = new Command()
            .description('One-step Provenance blockchain')
            .version(CAVENDISH_CLI_VERSION, '-v, --version', 'output the current version')
            .addCommand(this.startCommand, { isDefault: true })
            .addCommand(this.stopCommand)
            .addCommand(this.resetCommand);
    }

    public run(argv: string[]): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            this.cli.parse(argv);

            // get the provenanced binary and the PIO_HOME directory
            this.provenanced = Cavendish.getProvenancedBinary();
            this.pioHome = Cavendish.getPIOHomeDirectory();

            // load the lock file
            this.lockFile = new LockFile(path.join(this.pioHome, 'cavendish.lock'));

            switch(this.command) {
                case CavendishCommand.START: {
                    this.start(argv).then(() => {
                        resolve();
                    }).catch((err) => {
                        reject(err);
                    });
                } break;

                case CavendishCommand.STOP: {
                    this.stop(argv).then(() => {
                        resolve();
                    }).catch((err) => {
                        reject(err);
                    });
                } break;

                case CavendishCommand.RESET: {
                    this.reset(argv).then(() => {
                        resolve();
                    }).catch((err) => {
                        reject(err);
                    });
                } break;
            }
        });
    }

    protected start(argv: string[]): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {

            const options = this.startCommand
                .parse(argv)
                .opts();

            // load the config file
            try {
                this.config = await Cavendish.loadConfigFile(options.config);
            } catch (err) {
                return reject(err);
            }

            // override the config from the options
            try {
                this.config = await Cavendish.overrideConfig(this.config, options);
            } catch (err) {
                return reject(err);
            }

            // generate a pseudo-random mnemonic if one is not provided
            if (this.config.mnemonic === undefined) {
                const entropy: Buffer = randomBytes(32);
                const entropyHash = createHash('sha256').update(entropy).digest();
                this.config.mnemonic = bip39.entropyToMnemonic(entropyHash);
            }

            // ensure that it isn't already running
            const pid = await Cavendish.findProvenancePIDByHomeDir(this.pioHome);
            if (pid !== -1) {
                if (options.force) {
                    // stop the node
                    await this.stop([]);
                } else {
                    this.lockFile.pid = pid;

                    return reject(new Error('The provenance node is already running'));
                }
            }

            // calculate the hash assigned to the validator at genesis
            const hashSupply = new BigNumber(this.config.hashSupply);
            const validatorHash = hashSupply.times(VALIDATOR_HASH_RATIO).integerValue(BigNumber.ROUND_DOWN);
            const validatorHashDelegation = validatorHash.times(VALIDATOR_DELEGATION_RATIO).integerValue(BigNumber.ROUND_DOWN);
            const accountsHashSupply = hashSupply.minus(validatorHash);
            const accountHash = accountsHashSupply.dividedBy(this.config.accounts).integerValue(BigNumber.ROUND_DOWN);

            if (!this.lockFile.initialized || options.force) {

                // say hello
                this.sayHello();

                // clear the old initialization if we need to force start
                if (options.force && fs.existsSync(this.pioHome)) {
                    await this.reset([]);
                    fs.mkdirSync(this.pioHome);
                }

                // initialize the config
                child_process.execSync([
                    this.provenanced,
                    '-t',
                    '--home', this.pioHome,
                    'init',
                    `--chain-id=${this.config.chainId}`,
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
                for(var key = 0; key < this.config.accounts; key++) {
                    this.addGenesisAccountFromMnemonic(`account${key}`, this.config.mnemonic, 0, key, accountHash.toFixed());
                }

                // create the root names
                this.config.rootNames.forEach((rootName) => {
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
                    `--chain-id=${this.config.chainId}`
                ].join(' '), EXEC_SYNC_OPTIONS);

                // create markers from config
                this.config.markers.forEach((marker) => {
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
                this.setConfig('rpc.laddr', `tcp://0.0.0.0:${this.config.ports.rpc}`);
                this.setConfig('grpc.address', `0.0.0.0:${this.config.ports.grpc}`);
                this.setConfig('grpc-web.enable', 'false');
                this.setConfig('api.enable', 'true');
                this.setConfig('api.swagger', 'true');

                // we're now initialized
                this.lockFile.initialized = true;
                this.lockFile.config = this.config;
            } else {
                if (!_.isEqual(this.config, this.lockFile.config)) {
                    return reject(new Error(`Configuration does not match the already initialized blockchain data.\nReset the blockchain data with 'cavendish reset' first.`));
                }

                // say hello
                this.sayHello();
            }

            // get the wallet for the accounts from the mnemonic
            const accounts = Wallet.fromMnemonic(this.config.mnemonic, false);

            // output the available accounts
            console.log('Available Accounts');
            console.log('==================');
            const numSpaces = (Math.floor(this.config.accounts / 10) + 4);
            for(var idx = 0; idx < this.config.accounts; idx++) {
                const key = accounts.getKey(0, idx);
                const accountIndex = `(${idx})`.toString().padEnd(numSpaces);
                console.log(`${accountIndex}${key.address} (${accountHash.toFixed()} nhash)`);
            }
            console.log('');

            // generate the base HD path for display
            let hdPathParts = HDPATH.split('/');
            hdPathParts[HDPathIndex.ADDRESS_INDEX] = "{account_index}'";
            const baseHdPath = hdPathParts.join('/');

            // output the base HD path
            console.log('HD Wallet');
            console.log('==================');
            console.log(`Mnemonic:      ${this.config.mnemonic}`);
            console.log(`Base HD Path:  ${baseHdPath}`);
            console.log('');

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
                await delay(1000);

                const pid = await Cavendish.findProvenancePIDByHomeDir(this.pioHome);
                if (pid === -1) {
                    return reject(new Error('Failed to start the provenance node'));
                } else {
                    // save the PID to the lock file
                    this.lockFile.pid = pid;
                }
            }

            return resolve();

        });
    }

    protected stop(argv: string[]): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {

            const pid = await Cavendish.findProvenancePIDByHomeDir(this.pioHome);
            if (pid === -1) {
                // clear the PID from the lock file
                this.lockFile.pid = undefined;

                return reject(new Error('The provenance blockchain is not currently running'));
            } else {
                // kill the procenance node
                await killProcess(pid);

                // clear the PID from the lock file
                this.lockFile.pid = undefined;

                return resolve();
            }

        });
    }

    protected reset(argv: string[]): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {

            // ensure that the node is not running
            const pid = await Cavendish.findProvenancePIDByHomeDir(this.pioHome);
            if (pid !== -1) {
                return reject(new Error('Cannot reset the blockchain data while provenance node is running'));
            }

            // delete the blockchain data
            if (fs.existsSync(this.pioHome)) {
                await rmDir(this.pioHome);
            }

            return resolve();

        });
    }

    protected sayHello() {
        console.log('');
        console.log(`Cavendish ${CAVENDISH_CLI_VERSION}`);
        console.log('');
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

    private static loadConfigFile(configFile: string): Promise<CavendishConfig> {
        return new Promise<CavendishConfig>((resolve, reject) => {
            if (fs.existsSync(configFile)) {
                resolve(JSON.parse(fs.readFileSync(configFile).toString('utf-8')));
            } else {
                if (configFile !== DEFAULT_CONFIG_FILE) {
                    return reject(new Error(`Unable to open config file '${configFile}'`));
                } else {
                    return resolve(DEFAULT_CONFIG);
                }
            }
        });
    }

    private static overrideConfig(config: CavendishConfig, options: OptionValues): Promise<CavendishConfig> {
        return new Promise<CavendishConfig>((resolve, reject) => {
            // override the config from the options
            if (options.mnemonic !== undefined) {
                config.mnemonic = options.mnemonic;
            }
            if (options.accounts !== undefined) {
                config.accounts = Number.parseInt(options.accounts);
            }
            if (options.chainId !== undefined) {
                config.chainId = options.chainId;
            }
            if (options.rpcPort !== undefined) {
                config.ports.rpc = options.rpcPort;
            }
            if (options.grpcPort !== undefined) {
                config.ports.grpc = options.grpcPort;
            }
            if (options.hashSupply !== undefined) {
                config.hashSupply = options.hashSupply;
            }
            if (options.restrictedRootNames !== undefined) {
                options.restrictedRootNames.split(',').forEach((restrictedName) => {
                    const name = Cavendish.findName(config.rootNames, restrictedName);
                    if (name !== undefined && !name.restrict) {
                        return reject(new Error(`Configuration does not match the already initialized blockchain data.\nReset the blockchain data with 'cavendish reset' first.`));
                    }
                    config.rootNames.push({ name: restrictedName, restrict: true });
                });
            }
            if (options.unrestrictedRootNames !== undefined) {
                options.unrestrictedRootNames.split(',').forEach((unrestrictedName) => {
                    const name = Cavendish.findName(config.rootNames, unrestrictedName);
                    if (name !== undefined && name.restrict) {
                        return reject(new Error(`Configuration does not match the already initialized blockchain data.\nReset the blockchain data with 'cavendish reset' first.`));
                    }
                    config.rootNames.push({ name: unrestrictedName, restrict: false });
                });
            }

            // set missing defaults
            if (config.accounts === undefined) {
                config.accounts = DEFAULT_ACCOUNTS;
            }
            if (config.chainId === undefined) {
                config.chainId = DEFAULT_CHAIN_ID;
            }
            if (config.ports.rpc === undefined) {
                config.ports.rpc = DEFAULT_RPC_PORT;
            }
            if (config.ports.grpc === undefined) {
                config.ports.grpc = DEFAULT_GRPC_PORT;
            }
            if (config.hashSupply === undefined) {
                config.hashSupply = DEFAULT_HASH_SUPPLY;
            }
            if (config.rootNames !== undefined) {
                config.rootNames = DEFAULT_ROOT_NAMES;
            }

            return resolve(config);
        });
    }

    private static findName(names: RootName[], name: string): (RootName | undefined) {
        var foundName: RootName = undefined;

        names.forEach((nameItem) => {
            if (nameItem.name === name) {
                foundName = nameItem;
            }
        });

        return foundName;
    }

    private static getProvenancedBinary(): string {
        return path.join(
            __dirname, 
            '..', 
            'bin', 
            os.arch(), 
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
                resolve(pid);
            }).catch((err) => {
                reject(err);
            })
        });
    }

    public static run(argv: string[]): Promise<void> {
        const cavendish = new Cavendish();
        return cavendish.run(argv);
    }

    private cli: Command;
    private startCommand: Command;
    private stopCommand: Command;
    private resetCommand: Command;

    private config: CavendishConfig;
    private provenanced: string;
    private pioHome: string;
    private command: CavendishCommand = CavendishCommand.START;
    private lockFile: LockFile;

}
