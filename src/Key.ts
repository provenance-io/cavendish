import { bech32 } from 'bech32';
import { BIP32Interface } from 'bip32';
import { createHash } from 'crypto';
import * as RIPEMD160 from 'ripemd160';

export class Key {

    constructor(hrp: string, key: BIP32Interface, mainnet: boolean) {
        this.hrp = hrp;
        this.key = key;
        this.mainnet = mainnet;
    }

    get address(): string {
        const hash = Key.sha256hash160(this.key.publicKey);
        return bech32.encode(this.hrp, bech32.toWords(hash));
    }

    get publicKey(): string {
        return this.key.publicKey.toString('hex');
    }

    get publicKeyData(): Buffer {
        return this.key.publicKey;
    }

    private readonly hrp: string;
    private readonly key: BIP32Interface;
    private readonly mainnet: boolean;

    private static sha256(input: Buffer): Buffer {
        return createHash('sha256').update(input).digest();
    }

    private static sha256hash160(input: Buffer): Buffer {
        const sha256 = Key.sha256(input);
        const ripemd160 = new RIPEMD160();
        return ripemd160.update(sha256).digest();
    }

}
