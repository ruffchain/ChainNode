
# Read header from db
```
添加个header dump的工具，chainnode同步最新，npm run build

node dist/blockchain-sdk/src/tool/header.js --data data/dposbft/miner1/ --height 2

```
#  restore_storage

node ./dist/blockchain-sdk/src/tool/restore_storage.js  restore --dataDir ./data/dposbft/miner2 --height 50 --output ./data/dposbft/

# trim the node
* Use check to figure out the trim-height

```
node ./dist/blockchain-sdk/src/tool/restore_storage.js restore --dataDir ${path1} --height ${height} --output ./data/dposbft/
```

* Use trim to trim the node-state for every nodes
* Affected data
    - database
    - txview
    - storage/log
    - storage/dump


```
node ./dist/blockchain-sdk/src/tool/trim.js  check --dataDir ./data/dposbft/miner2 --cfgFile ./config/tcpminer1.cfg

node ./dist/blockchain-sdk/src/tool/trim.js  check --dataDir ./data/dposbft/miner1 --cfgFile ./config/internal/tcpminer1.cfg
node ./dist/blockchain-sdk/src/tool/trim.js  check --dataDir ./data/dposbft/miner2 --cfgFile ./config/internal/tcpminer2.cfg
node ./dist/blockchain-sdk/src/tool/trim.js  check --dataDir ./data/dposbft/miner3 --cfgFile ./config/internal/tcpminer3.cfg

We found the tip of node is 1000. A recommended trim point is height< 1000, for example 995, or smaller,  will be good.



node ./dist/blockchain-sdk/src/tool/trim.js  trim --dataDir ./data/dposbft/miner1 --cfgFile ./config/internal/tcpminer1.cfg --height 20
node ./dist/blockchain-sdk/src/tool/trim.js  trim --dataDir ./data/dposbft/miner2 --cfgFile ./config/internal/tcpminer2.cfg --height 20
node ./dist/blockchain-sdk/src/tool/trim.js  trim --dataDir ./data/dposbft/miner3 --cfgFile ./config/internal/tcpminer3.cfg --height 20

Start the genesis-node first, then the other nodes.


```