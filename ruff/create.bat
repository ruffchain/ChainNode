node ./dist/blockchain-sdk/src/tool/host.js create ^
--package "./dist/blockchain-sdk/ruff/chain" --externalHandler ^
--dataDir "./data/ruff/genesis" ^
--loggerConsole --loggerLevel debug ^
--genesisConfig "./dist/blockchain-sdk/ruff/chain/genesis.json" %*