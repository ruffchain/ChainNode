
# Read header from db
```
添加个header dump的工具，chainnode同步最新，npm run build

node dist/blockchain-sdk/src/tool/header.js --data data/dposbft/miner1/ --height 2

```
#  restore_storage

node ./dist/blockchain-sdk/src/tool/restore_storage.js  restore --dataDir ./data/dposbft/miner2 --height 50 --output ./data/dposbft/

