import {BlockHeader} from '../../core/dpos_chain/block';
import {getBestHeaders} from './headersTool';
import { addressFromPublicKey } from '../../core/address';

if (require.main === module) {
    if (!process.argv[2]) {
        console.log('Usage: node getDPOSHeaders.js <dataDir>');
        process.exit(1);
    }
    
    async function main() {
        let headers = await getBestHeaders(process.argv[2], BlockHeader);

        let coinbases = new Map();
    
        headers.forEach((value, index) => {
            if (value.number === 0) {
                return;
            }
            let address = addressFromPublicKey((value as BlockHeader).pubkey);
            //console.log(`${index}:${address}`);
            if (value.number === 100) {
                console.log(`height 100 storageHash: ${value.storageHash}, creator: ${address}`);
            }
            if (coinbases.has(address)) {
                coinbases.set(address, coinbases.get(address)+1);
            } else {
                coinbases.set(address, 1);
            }
        });

        for (const [address, amount] of coinbases) {
            console.log(`${address}: ${amount}`);
        }
    }
    
    main();
}