import * as fsextra from 'fs-extra';
import { Miner as DPOSMiner } from "../../core/dpos_chain/miner";
import { Chain as DPOSChain } from "../../core/dpos_chain/chain";
import { BlockHeader as DPOSHeader } from "../../core/dpos_chain/block";
import { ValueHandler } from "../../core/value_chain/handler";
import { Transaction } from "../../core/value_chain/transaction";
import { Node } from "../../core/net_standalone/node";

export async function createDPOSGenesis(dataDir: string, secret: string | Buffer, genesisOptions: any, forceRegenerate: boolean) {
    if (forceRegenerate) {
        fsextra.removeSync(dataDir);
    }
    if (fsextra.existsSync(dataDir)) {
        return;
    }
    let config = {
        loggerOptions: { console: true, level: 'debug', file: { root: dataDir } },
        coinbase: '',
        minerSecret: Buffer.isBuffer(secret) ? secret : Buffer.from(secret, 'hex'),
        dataDir: dataDir,
        handler: new ValueHandler(),
        node: new Node('genesis'),
    }

    fsextra.ensureDirSync(config.dataDir);
    let miner = new DPOSMiner(config);
    let ret = await miner.create(genesisOptions);
    await miner.initialize();
    await new Promise((reslove) => {
        miner.on('onTipBlock', (height) => {
            if (height === 1) {
                console.log(`data init ret ${ret}!`);
                process.exit(0);
            } else {
                console.error(`error: on unexcepted tip Block: ${height}`);
            }
        });
    })
}

if (require.main === module) {
    if (process.argv.length < 4) {
        console.log('Usage: node createDPOSGenesis.js <dataDir> <secret> {genesisFile} {forceRegenerate: true/false} ...');
        process.exit(1);
    }

    async function main() {
        let options = {}
        let force = (process.argv.length > 4 && process.argv[process.argv.length - 1] === 'true');
        if (process.argv[4] && fsextra.existsSync(process.argv[4])) {
            options = fsextra.readJSONSync(process.argv[4]);
        }
        await createDPOSGenesis(process.argv[2], process.argv[3], options, force)
    }

    main();
}