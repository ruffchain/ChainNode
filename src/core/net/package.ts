
export type PackageHeader = {
    magic: number;
    version: number;
    flags: number;
    cmdType: number;
    totalLength: number;
    bodyLength: number;
};

// Yang Jun 2019-10-24
export type PackageTipSignBody = {
    froms: string[];
    depth: number;
    height: number;  // 
    source: string;  // source BP address
};

export const MAX_PACKAGE_TIPSIGN_DEPTH = 10; // Normally it is not used

export function createTipSignBody(address: string, inHeight: number): any {
    return {
        froms: [address],
        depth: MAX_PACKAGE_TIPSIGN_DEPTH,
        height: inHeight,
        source: address
    }
}

///////////////

export class Package {
    private m_header: PackageHeader;
    private m_body: any;
    private m_data: Buffer[];

    public static headerLength: number = 16;
    public static magic: number = 0x8083;

    constructor() {
        this.m_header = {
            magic: Package.magic,
            version: 0,
            flags: 0,
            cmdType: 0,
            totalLength: 0,
            bodyLength: 0,
        };
        this.m_body = {};
        this.m_data = [];
    }

    get header(): PackageHeader {
        return this.m_header;
    }

    get body(): any {
        return this.m_body;
    }

    get data(): Buffer[] {
        return this.m_data;
    }

    copyData(): Buffer {
        let buffer = Buffer.alloc(this.dataLength);
        let copyStart = 0;
        for (let data of this.data) {
            data.copy(buffer, copyStart);
            copyStart += data.length;
        }
        return buffer;
    }

    get dataLength() {
        const header = this.m_header;
        return header.totalLength - Package.headerLength - header.bodyLength;
    }
}
