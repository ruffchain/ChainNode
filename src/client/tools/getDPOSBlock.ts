import { getBlock, blockToObj, valueTransToObj } from "./blockTools";
import { BlockHeader } from "../../core/dpos_chain/block";
import { Transaction } from "../../core/value_chain/transaction";

async function getDPOSBlock(dataDir: string, height:number) {
    return getBlock(dataDir, height, BlockHeader, Transaction);
}

if (require.main === module) {
    if (!process.argv[2]) {
        console.log('Usage: node getDPOSBlock.js <dataDir> {height}');
        process.exit(1);
    }

    async function main() {
        let block = await getDPOSBlock(process.argv[2], parseInt(process.argv[3]));
        if (block) {
            let info = blockToObj(block, valueTransToObj);
            console.log(JSON.stringify(info));
        }
    }
    
    main();
}