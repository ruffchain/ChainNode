
**当前不可通过命令行参数调整的值**
参数名|类型|默认值|说明
---|-------|---------|---------
initializePeerCount|number|1|初始化前要同步数据的节点数量，只有向指定数量的节点同步数据后，节点才可以正常工作
headerReqLimit|number|2000|同步时每次请求的最大header数，dposChain中这个值无意义，每次会请求到当前选举轮的最后一块
confirmDepth|number|6|确认块深度,距离当前tip高度超过这个值的块即为确认块。分支合并操作只存在于非确认块上
minOutbound|number|8|最小主动连接节点数，当主动连接的节点小于这个值时，除非节点发现不能发现任何新节点，否则会一直尝试获取新节点并连接

**当前可以通过命令行调整的值**
参数名|类型|默认值|说明
---|-------|---------|---------
dataDir|string||数据存储位置，包括块数据，状态及本地数据库，日志文件等
handler|string||handler文件所在位置，该文件为链处理函数的入口
coinbase|string||miner专用，标识当该miner产生一个block时，这个block的工资进入到哪个账户
minerSecret|string||miner用此secret给自己产生的block签名。如果不存在coinbase参数，该sercet对应的address会被设置为coinbase