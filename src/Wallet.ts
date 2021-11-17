import {
    BIP32Factory, 
    BIP32Interface, 
 } from 'bip32';
import * as bip39 from 'bip39';
import { createHmac } from 'crypto';
import * as ecc from 'tiny-secp256k1';

const bip32 = BIP32Factory(ecc);

import { Key } from './Key';

export enum HDPathIndex {
    MARKER = 0,
    PURPOSE,
    COIN_TYPE,
    ACCOUNT,
    CHANGE,
    ADDRESS_INDEX
}

const MASTER_SECRET = Buffer.from('Bitcoin seed', 'utf8');
const PRIVATE_KEY_SIZE = 32
const CHAINCODE_SIZE = 32

const MAINNET_BECH32_HRP = 'pb';
const MAINNET_BIP32_HDPATH = "m/44'/505'/0'/0/0'";

const TESTNET_BECH32_HRP = 'tp';
const TESTNET_BIP32_HDPATH = "m/44'/1'/0'/0/0'";

export class KeyError extends Error {
    constructor(msg: string) {
        super(msg);
        Object.setPrototypeOf(this, KeyError.prototype);
    }
}

export class Wallet {

    public static fromBip32(bip32enc: string, mainnet: boolean = true): Wallet {
        return new Wallet(
            (mainnet ? MAINNET_BECH32_HRP : TESTNET_BECH32_HRP), 
            (mainnet ? MAINNET_BIP32_HDPATH : TESTNET_BIP32_HDPATH), 
            bip32.fromBase58(bip32enc),
            mainnet
        );
    }

    public static fromSeed(seed: Buffer, mainnet: boolean = true): Wallet {
        return new Wallet(
            (mainnet ? MAINNET_BECH32_HRP : TESTNET_BECH32_HRP), 
            (mainnet ? MAINNET_BIP32_HDPATH : TESTNET_BIP32_HDPATH), 
            bip32.fromSeed(seed),
            mainnet
        );
    }

    public static fromPrivateKey(privateKey: Buffer, chainCode: Buffer, mainnet: boolean = true): Wallet {
        return new Wallet(
            (mainnet ? MAINNET_BECH32_HRP : TESTNET_BECH32_HRP), 
            (mainnet ? MAINNET_BIP32_HDPATH : TESTNET_BIP32_HDPATH), 
            bip32.fromPrivateKey(privateKey, chainCode),
            mainnet
        );
    }

    public static fromMnemonic(mnemonic: string, mainnet: boolean = true, passphrase?: string): Wallet {
        const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase);
        const hmac = createHmac('sha512', MASTER_SECRET);
        hmac.update(seed);
        const digest = hmac.digest();
        const privateKey = Buffer.from(digest.subarray(0, PRIVATE_KEY_SIZE));
        const chainCode = Buffer.from(digest.subarray(PRIVATE_KEY_SIZE, PRIVATE_KEY_SIZE + CHAINCODE_SIZE));

        return Wallet.fromPrivateKey(privateKey, chainCode, mainnet);
    }

    constructor(hrp: string, hdpath: string, key: BIP32Interface, mainnet: boolean) {
        this.hrp = hrp;
        this.hdpath = hdpath;
        this.key = key;
        this.mainnet = mainnet;
    }

    public getKey(keyring: number, key: number): Key {
        if (!Number.isInteger(keyring)) {
            throw new KeyError(`Keyring ${keyring} is not an integer`);
        }
        if (!Number.isInteger(key)) {
            throw new KeyError(`Key ${key} is not an integer`);
        }

        let hdpath_parts = this.hdpath.split('/');
        hdpath_parts[HDPathIndex.CHANGE] = keyring.toString();
        hdpath_parts[HDPathIndex.ADDRESS_INDEX] = key.toString() + "'";
        let chpath = hdpath_parts.join('/');
        return new Key(this.hrp, this.key.derivePath(chpath), this.mainnet);
    }

    private readonly hrp: string;
    private readonly hdpath: string;
    private readonly key: BIP32Interface;
    private readonly mainnet: boolean;

}
