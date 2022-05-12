import {
    Cavendish,
    DEFAULT_CONFIG_FILE,
    DEFAULT_CONFIG,
} from './Cavendish';

import { 
    Command, 
    OptionValues, 
} from 'commander';

import { 
    CavendishConfig, 
    RootName, 
} from './Config';

enum CavendishCommand {
    START,
    STOP,
    RESET
}

export const CAVENDISH_CLI_VERSION = '1.8.2';

export class CavendishCLI {

    constructor() {
        // setup the start command
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

        // setup the stop command
        this.stopCommand = new Command('stop')
            .description('Stops a running provenance blockchain node')
            .action(() => {
                this.command = CavendishCommand.STOP;
            });

        // setup the reset command
        this.resetCommand = new Command('reset')
            .description('Resets the provenance blockchain')
            .action(() => {
                this.command = CavendishCommand.RESET;
            });

        // setup the root command
        this.cli = new Command()
            .description('One-step Provenance blockchain')
            .version(CAVENDISH_CLI_VERSION, '-v, --version', 'output the current version')
            .addCommand(this.startCommand, { isDefault: true })
            .addCommand(this.stopCommand)
            .addCommand(this.resetCommand);

        // create the cavendish runner
        this.cavendish = new Cavendish();
    }

    public run(argv: string[]): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            // parse the arguments
            this.cli.parse(argv);

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
                if (options.config !== DEFAULT_CONFIG_FILE) {
                    return reject(new Error(`Unable to open config file '${options.config}'`));
                } else {
                    this.config = DEFAULT_CONFIG;
                }
            }

            // override the config from the options
            try {
                this.config = await CavendishCLI.overrideConfig(this.config, options);
            } catch (err) {
                return reject(err);
            }

            // start the blockchain
            this.cavendish.start(this.config, {
                background: options.background,
                force: options.force, 
                verbose: true
            }).then(() => {
                return resolve();
            }).catch((err) => {
                return reject(err);
            });

        });
    }

    protected stop(argv: string[]): Promise<void> {
        // stop the blockchain
        return this.cavendish.stop();
    }

    protected reset(argv: string[]): Promise<void> {
        // reset the blockchain
        return this.cavendish.reset();
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
                    const name = CavendishCLI.findName(config.rootNames, restrictedName);
                    if (name !== undefined && !name.restrict) {
                        return reject(new Error(`Configuration does not match the already initialized blockchain data.\nReset the blockchain data with 'cavendish reset' first.`));
                    }
                    config.rootNames.push({ name: restrictedName, restrict: true });
                });
            }
            if (options.unrestrictedRootNames !== undefined) {
                options.unrestrictedRootNames.split(',').forEach((unrestrictedName) => {
                    const name = CavendishCLI.findName(config.rootNames, unrestrictedName);
                    if (name !== undefined && name.restrict) {
                        return reject(new Error(`Configuration does not match the already initialized blockchain data.\nReset the blockchain data with 'cavendish reset' first.`));
                    }
                    config.rootNames.push({ name: unrestrictedName, restrict: false });
                });
            }

            // set missing defaults
            if (config.accounts === undefined) {
                config.accounts = DEFAULT_CONFIG.accounts;
            }
            if (config.chainId === undefined) {
                config.chainId = DEFAULT_CONFIG.chainId;
            }
            if (config.ports.rpc === undefined) {
                config.ports.rpc = DEFAULT_CONFIG.ports.rpc;
            }
            if (config.ports.grpc === undefined) {
                config.ports.grpc = DEFAULT_CONFIG.ports.grpc;
            }
            if (config.hashSupply === undefined) {
                config.hashSupply = DEFAULT_CONFIG.hashSupply;
            }
            if (config.rootNames !== undefined) {
                config.rootNames = DEFAULT_CONFIG.rootNames;
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

    public static run(argv: string[]): Promise<void> {
        const cavendish = new CavendishCLI();
        return cavendish.run(argv);
    }

    private cli: Command;
    private startCommand: Command;
    private stopCommand: Command;
    private resetCommand: Command;

    private cavendish: Cavendish;

    private config: CavendishConfig;
    private command: CavendishCommand = CavendishCommand.START;

}
