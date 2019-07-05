import { parseCommand, initLogger, initUnhandledRejection } from "../common";
import { checkMain } from "./libtrim/check";
import { trimMain } from "./libtrim/trimit";

// to trim node database

const logger = initLogger({ loggerOptions: { console: true } });
initUnhandledRejection(logger);

async function main() {
    const commandTip = `Usage: node trim.js check --dataDir [data dir] \n node trim.js trim --dataDir [data dir] --height [block height]`;
    let command = parseCommand(process.argv);
    if (!command || !command.command) {
        console.log(commandTip);
    }
    // logger.info(JSON.stringify(command));
    console.log(command);
    const dataDir = command!.options.get('dataDir');
    if (!dataDir) {
        console.log(commandTip);
        return;
    }

    if (command!.command === 'check') {
        console.log('\ncheck node state =>');

        await checkMain(logger, dataDir);

    } else if (command!.command === 'trim') {
        console.log('\ntrim node state =>');
        let height = command!.options.get('height');
        if (!height) {
            console.log(commandTip);
            return;
        }

        await trimMain(parseInt(height + ''), logger, dataDir);
    }

}

main();