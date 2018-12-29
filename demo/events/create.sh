node ./dist/blockchain-sdk/src/tool/host.js create \
--package "./dist/blockchain-sdk/demo/events/chain" --externalHandler \
--dataDir "./data/events/genesis" \
--loggerConsole --loggerLevel debug \
--genesisConfig "./dist/blockchain-sdk/demo/events/chain/genesis.json" 