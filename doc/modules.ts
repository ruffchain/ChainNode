
// namespace Storage {
//     export interface StorageTransaction {
//         commit();
//         rollback();
//     }
//     export interface StorageSnapshot {
//         blockNumber: number;
//         messageDigest(): ByteString;
//     }
//     export interface Storage {
//         createSnapshot(blockNumber: number): StorageSnapshot;
//         recover(s: StorageSnapshot);
//         beginTransaction(): StorageTransaction;
//         getSnapshots(): StorageSnapshot[];
//         // RW interfaces ?
//     }
// }

// interface Serializable {
//     encode(): ArrayBuffer;
//     decode(): ArrayBuffer;
// }

// namespace BlockChain {
//     export interface BlockHeader extends Serializable {
//         blockNumber: number;
//         hash: ByteString;
//         storage: ByteString;
//         preBlock: ByteString;
//         merkleRoot: ByteString;
//         verify();
//     }

//     export interface Block extends Serializable {
//         header: BlockHeader;
//         transactions: Receipt[];
//         // 包含共识认证的逻辑
//         verify();
//         save();
//     }

//     export class Chain {
//         public pending: Transaction[];
//         public latestBlock: Block;
//         public node: Network.Node;
//         public initialize() {
//             // IBD is same
//             // 1. load latest saved block from disk
//             this.latestBlock = null;
//             // 2. broad cast header
//             this.node.broadcast(this.latestBlock.header);
//             this.node.onData((from, data) => {
//                 for (const header of data) {
//                     if (header.blockNumber > this.latestBlock.header.blockNumber) {
//                         // 3. download all new block
//                         this.node.sendTo(from, new Serializable(/*blocks*/));
//                         this.node.onData((from, data)=>{
//                             for (let block of data) {
//                                 block.verfiy();
//                                 new Executor.BlockExecutor().execute(block);
//                             }
//                         });
//                     }
//                 }
//             });
//         }
//         run() {
//             this.node.onData((from, data)=>{
//                 if (data instanceof Transaction) {
//                     this.node.broadcast(data);
//                 } else if (data instanceof Block) {
//                     if (new Executor.BlockExecutor().execute(block)) {
//                         this.node.broadcast(data);
//                     }
//                 } 
//             });
//         }
//         mine() {
//             setInterval(()=>{
//                 let block = new Block();
//                 for (let tx of this.pending) {
//                     block.transactions.push(tx);
//                     new Executor.BlockExecutor(block);
//                     block.save();
//                     this.node.broadcast(block);
//                 }
//             }, 15000);
//             this.node.onData((from, data)=>{
//                 if (data instanceof Transaction) {
//                     this.pending.push(data);
//                     this.node.broadcast(data);
//                 } else if (data instanceof Block) {
//                     if (new Executor.BlockExecutor().execute(block)) {
//                         this.node.broadcast(data);
//                     }
//                 } 
//             });
//         }
//     }

//     export class Transaction {
//         hash:ByteString;
//         publicKey:String;
//         type:String;
//         data:ArrayBuffer;
//         // fee:Number;
//         // value:Number;
//         signature:ByteString;
//         verify() {
//             // verify signature with publicKey 
//         }
//         sign(pk:ByteString, sk:ByteString) {
//             // create signature with secret key
//         }
//     }


//     export class Receipt {
//         tx:Transaction;
//         result:Number;
//         logs:ArrayBuffer;
//     }
// }


// namespace Network {
//     interface Peer {
        
//     }
//     export interface Node {
//         listen();
//         broadcast(data:Serializable);
//         sendTo(to:Peer, data:Serializable);
//         onData(callback:(from:Peer, data:Serializable)=>void);
//     }
// }

// namespace Executor {
//     export interface Handler {
//         executeTransaction(tx:BlockChain.Transaction):Number;
//     }

//     export interface TransactionExecutor {
//         execute(storage:Storage.StorageTransaction, block:BlockChain.Block, tx:BlockChain.Transaction):BlockChain.Receipt;
//     }

//     class MethodExecutor implements TransactionExecutor {
//         MethodExecutor(handler:Handler) {
            
//         }
//     }

//     class EventExecutor implements TransactionExecutor {
//         MethodExecutor(handler:Handler) {

//         }
//     }   


//     class BlockExecutor {
//         storage:Storage.Storage; 
//         txExecutors:Map<String, TransactionExecutor>;        
//         execute(block:BlockChain.Block):boolean {
//             for (let ss of this.storage.getSnapshots()) {
//                 if (ss.blockNumber === block.header.blockNumber - 1) {
//                     this.storage.recover(ss);
//                 }
//             }
//             // 还要额外验证 Event是否该在这个block里面触发
//             // 准备运行环境
//             for (let receipt of block.transactions) {
//                 let store = this.storage.beginTransaction();
//                 if (this.txExecutors.get(receipt.tx.type).execute(store, block, receipt.tx)) {
//                     store.commit();
//                 } else {
//                     store.rollback();
//                 }
//             }
//             return this.storage.createSnapshot(block.header.blockNumber).messageDigest === block.header.storage;
//         }
//     }
// }

// namespace sdk {
//    export class Application {
//         node:Network.Node;
//         chain:BlockChain.Chain;
//         handler:Executor.Handler;

//         main() {
//             this.chain.initialize();
//             this.chain.run();
//             this.chain.mine();
//         }
//     }
// }


// //共识特化POW
// namespace POW {
//     class Chain implements BlockChain.Chain {
        
//     }

//     class Block implements BlockChain.Block {
//         nonce:number;
//         verify() {
//             // pow get hash
//         }
//     }
// }

// //共识特化DPOS
// namespace DPOS {
//     class Chain implements BlockChain.Chain {
//     }

//     class Block implements BlockChain.Block {
//         miner:String;
//         verify() {
//             // verify right miner
//         }
//     }

//     class VoteTransactionExecutor implements Executor.TransactionExecutor {

//     }
// }



