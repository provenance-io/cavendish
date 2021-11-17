# Cavendish

Cavendish is a command-line tool for quickly starting a local [Provenance](https://provenance.io) blockchain.

**What is Provenance?**

Provenance is a distributed, proof of stake blockchain designed for the financial services industry.

For more information about [Provenance Inc](https://provenance.io) visit https://provenance.io

**Why Cavendish?**

Performing functional tests of Provenance aware code, either locally or say in a GitHub action as a part of your CI/CD workflow, is incredibly useful during active development, but the current solutions are a bit cumbersome.

Starting a local Provenance blockchain for testing can already be done a number of different ways:

1. Cloning the [provenance](https://github.com/provenance-io/provenance) repo and running: `make build localnet-start`
2. Writing a script that creates the genesis file, config, etc. and starts a local chain.

But these solutions make it difficult to create genesis accounts and fund them with hash. For local testing (of smart contracts, services, etc.) it is necessary to first transfer `nhash` from the root validator account to any test accounts.

So Cavendish was created to make this process easier!

## Installing

For global use:

```sh
$ npm install -g @provenanceio/cavendish
```

For unit testing inside a project (like a smart contract):

```sh
$ npm install --save-dev @provenanceio/cavendish
```

## Usage

Starting a quick blockchain is as simple as running the `cavendish` command:

```sh
$ cavendish

Cavendish 1.7.5

Available Accounts
==================
(0)  tp1aat3l2m362vyj74rhajr8yng8r05rvl3c0uxzn (8000000000000000000 nhash)
(1)  tp13n9htv3464hpe6sr9y8uhkgf2j3ystds8tzqhv (8000000000000000000 nhash)
(2)  tp1sp4f0ymwc84j0f4d4cu72gvhjuw7wsszcutux7 (8000000000000000000 nhash)
(3)  tp1szmgnu930sf5yjhwqs7uqqhrg5lgjn3nv4np4d (8000000000000000000 nhash)
(4)  tp1ks4age4v6k2q0hqfaed9s8rtgu32d48s040qzn (8000000000000000000 nhash)
(5)  tp1c0cwv0crh8j44250td4f4xu8gdmg89ecfuv0qj (8000000000000000000 nhash)
(6)  tp1a6xak7grxhqzk2xdvmkydhdutkqwghmdy78y55 (8000000000000000000 nhash)
(7)  tp1l3d9a27jmnfwd75a7wp66wasucu2x28js6njyl (8000000000000000000 nhash)
(8)  tp1sfgmdrh9w66vxympqvxnkcqjhf64fjprn0lwxv (8000000000000000000 nhash)
(9)  tp1p589suu7c07adxuzl8hujw4a3u47pvfea7k8x4 (8000000000000000000 nhash)

HD Wallet
==================
Mnemonic:      name broom medal pen slogan blush version banana message grant all decline weekend rhythm near art imitate milk winter clap awesome green soccer beauty
Base HD Path:  m/44'/1'/0'/0/{account_index}'
```

By default 10 accounts are created and funded with hash using a pseudo-randomly generated bip-39 mnemonic.

But every aspect of your local chain is configurable either through options to the `cavendish` command or a [config file](#config-file) in your working directory.

## Command Help

```sh
$ cavendish --help

Usage: cavendish [options] [command]

One-step Provenance blockchain

Options:
  -v, --version    output the current version
  -h, --help       display help for command

Commands:
  start [options]  Start a provenance blockchain node
  stop             Stops a running provenance blockchain node
  reset            Resets the provenance blockchain
  help [command]   display help for command
```

### Start command

```sh
cavendish start --help

Usage: cavendish start [options]

Start a provenance blockchain node

Options:
  -c, --config <file>                            the cavendish config file (default: "cavendish.json")
  -f, --force                                    force resets the blockchain
  -b, --background                               run the blockchain in the background
  -m, --mnemonic <phrase>                        bip39 mnemonic phrase for generating seed
  -a, --accounts <num>                           total accounts to generate
  -r, --restrictedRootNames <name1,name2,...>    list of restricted root names to create
  -u, --unrestrictedRootNames <name1,name2,...>  list of unrestricted root names to create
  -s, --hashSupply <supply>                      the total supply of nhash tokens
  -i, --chainId <id>                             the provenance chain id
  -p, --rpcPort <port>                           the port to use for RPC connections to the node
  -g, --grpcPort <port>                          the port to use for gRPC connections to the node
  -h, --help                                     display help for command
```

### Stop command

```sh
cavendish stop --help

Usage: cavendish stop [options]

Stops a running provenance blockchain node

Options:
  -h, --help  display help for command
```

### Reset command

```sh
cavendish reset --help

Usage: cavendish reset [options]

Resets the provenance blockchain

Options:
  -h, --help  display help for command
```

## Config File

### Location

The default configuration file is called `cavendish.json` and is located at the root of your project directory. It must contain a JSON object representing your blockchain configuration like the example below:

```json
{
  "mnemonic": "name broom medal pen slogan blush version banana message grant all decline weekend rhythm near art imitate milk winter clap awesome green soccer beauty",
  "accounts": 10,
  "chainId": "chain-local",
  "ports": {
    "rpc": 26657,
    "grpc": 9090
  },
  "hashSupply": "100000000000000000000",
  "rootNames": [
    { "name": "pio", "restrict": true },
    { "name": "pb", "restrict": false },
    { "name": "io", "restrict": true },
    { "name": "provenance", "restrict": true }
  ],
  "markers": [
    {
      "denom": "hotdog.coin",
      "totalSupply": "1000000000000",
      "manager": "validator",
      "access": [
        "admin",
        "mint",
        "burn"
      ]
    }
  ]
}
```

### Account options

#### mnemonic

Specifies the bip-39 mnemonic phrase to be used as the seed for HD account generation. The mnemonic is randomly generated on startup if not provided.

#### accounts

Specifies the number of keys from the HD account to fund with `nhash` (default = 10).

### Blockchain options

#### chainId

Specifies the chain id of the blockchain (default = chain-local).

#### ports

Specifies the RPC and gRPC ports to open on localhost.

The default is:
```json
"ports": {
  "rpc": 26657,
  "grpc": 9090
}
```

#### hashSupply

Specifies the total fixed supply of hash to mint (default = 100000000000000000000).

### Module options

#### rootNames

Specifies the root names to create and their restriction levels.

The default is:
```json
"rootNames": [
  { "name": "pio", "restrict": true },
  { "name": "pb", "restrict": false },
  { "name": "io", "restrict": true },
  { "name": "provenance", "restrict": true }
]
```

#### markers

Specifies additional markers to create. Each entry contains the denom, total supply, the manager account, and the access for the marker. By default, no additional markers are created.

***Note: Creating markers from the command line is not supported. If additional markers are needed for your project, test, etc. then you must use a config file.***