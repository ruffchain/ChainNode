node ./dist/blockchain-sdk/src/tool/host.js create \
     --package "./dist/blockchain-sdk/ruff/dposbft/chain" --externalHandler \
     --dataDir "./data/dposbft/genesis"  \
     --loggerConsole --loggerLevel debug  \
     --genesisConfig "./dist/blockchain-sdk/ruff/dposbft/chain/genesis.json"
