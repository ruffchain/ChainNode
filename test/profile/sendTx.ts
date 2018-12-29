// import { ChainClient, BigNumber, addressFromSecretKey, ValueTransaction, parseCommand, initUnhandledRejection, initLogger, MapFromObject } from '../../src/client';
// initUnhandledRejection(initLogger({ loggerOptions: { console: true } }));

// async function main() {
//     let command = parseCommand(process.argv);
//     const secret = '64d8284297f40dc7475b4e53eb72bc052b41bef62fecbd3d12c5e99b623cfc11';
//     const address = addressFromSecretKey(secret);
//     const host = command!.options.has('host') ? command!.options.get('host') : '127.0.0.1';
//     const port = command!.options.has('port') ? parseInt(command!.options.get('port')) : 18089;
//     const txPerSec = command!.options.has('txPerSec') ? parseInt(command!.options.get('txPerSec')) : 10;

//     let chainClient = new ChainClient({
//         host,
//         port,
//         logger: initLogger({ loggerOptions: { console: true } })
//     });

//     let { err, nonce } = await chainClient.getNonce({ address: address! });
//     if (err) {
//         console.error(`transferTo getNonce failed for ${err}`);
//         return;
//     }
//     let curNonce: number = nonce! + 1;
//     let interval = Math.floor(1000 / txPerSec);
//     let countPerCycle = 1;
//     if (interval < 30) {
//         interval = 30;
//         countPerCycle = Math.floor(30 * txPerSec / 1000);
//     }

//     setInterval(async () => {
//         for (let index = 0; index < countPerCycle; index++) {
//             let tx = new ValueTransaction();
//             tx.method = 'transferTo',
//             tx.value = new BigNumber(1);
//             tx.fee = new BigNumber(1);
//             tx.input = { to: '13CS9dBwmaboedj2hPWx6Dgzt4cowWWoNZ' };
//             console.log(`transferTo chain nonce=${curNonce}`);
//             tx.nonce = curNonce++;
//             tx.sign(secret);
//             let sendRet = await chainClient.sendTransaction({tx});
//             if (sendRet.err) {
//                 console.error(`transferTo failed for ${sendRet.err}`);
//                 return ;
//             }
//             console.log(`send transferTo tx: ${tx.hash}`);
//         }
        
//     }, interval);
//     console.log(`sending...`);
// }

// main();
