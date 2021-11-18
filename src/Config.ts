export enum MarkerAccess {
    MINT = 'mint',
    BURN = 'burn',
    ADMIN = 'admin',
    WITHDRAW = 'withdraw',
    DEPOSIT = 'deposit'
};

export interface RootName {
    name: string,
    restrict: boolean
};

export interface MarkerConfig {
    denom: string,
    totalSupply: string,
    manager: string,
    access: MarkerAccess[]
};

export interface PortConfig {
    rpc: number,
    grpc: number
}

export interface CavendishConfig {
    mnemonic?: string;
    accounts?: number,
    chainId?: string,
    ports?: PortConfig,
    hashSupply?: string,
    rootNames?: RootName[],
    markers?: MarkerConfig[]
};
